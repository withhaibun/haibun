import { AStepper, type IHasCycles, type IHasOptions, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { getStepperOption, stringOrError } from "@haibun/core/lib/util/index.js";
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { DOMAIN_ROUTE } from "@haibun/core/lib/domains.js";
import type { IStepTransport } from "./domains/transport.js";
import { WEB_SERVER_PORT_OPTION } from "./domains/web-server.js";
import { capabilityVerifier } from "./pipelines/capability-verifier.js";
import { serveMcp, type TMcpParts } from "./pipelines/mcp.js";
import { heldServer, listeningPorts } from "./root.js";

/** The port of the MCP endpoint where both its own PORT and the web server's are unset. */
const MCP_PORT = 8128;
/** The path of the MCP endpoint where its MCP_PATH option isn't set. */
const MCP_PATH = "/mcp";

/**
 * MCP as a stepper of its own: each of actuality's steps the caller holds is a tool on the feature's web server, and a
 * tool's call runs through the server's dispatch, verified as an `/rpc` call is. The endpoint listens on its own PORT,
 * else on the web server's PORT, which it then shares, else on its own port.
 */
export default class McpStepper extends AStepper implements IHasOptions, IHasCycles, IStepTransport {
	description = "Expose all Haibun steps as callable MCP tools for LLM agents";
	readonly name = "McpStepper";

	options = {
		MCP_PATH: { desc: `Path for MCP endpoint, ${MCP_PATH} where unset`, parse: (p: string) => stringOrError(p) },
		PORT: { desc: "Port to listen on (overrides WebServer default)", parse: (p: string) => stringOrError(p) },
	};

	cycles = {
		startFeature: async () => {
			await this.serve();
		},
		endFeature: () => Promise.resolve(this.detach()),
	};

	/** Whether this feature's web server has the MCP routes. */
	private serving = false;
	private steppers: AStepper[] = [];
	private attached?: StepRegistry;
	private path = MCP_PATH;

	/** Lists actuality's registry. A caller that keeps a stream open receives a notice each time its steps change. */
	attach(registry: StepRegistry): void {
		this.attached = registry;
	}

	/** Stops serving as the feature's server closes. */
	detach(): void {
		this.serving = false;
	}

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		const path = getStepperOption(this, "MCP_PATH", world.moduleOptions);
		this.path = path === undefined ? MCP_PATH : path;
	}

	/** Actuality's registry, which actuality attaches this transport to before any feature starts. */
	private registry(): StepRegistry {
		if (!this.attached) throw new Error("McpStepper: a step registry isn't attached; the Executor attaches one before the first feature starts");
		return this.attached;
	}

	/** What MCP reads of actuality and the feature's server. */
	private parts(): TMcpParts {
		const world = this.getWorld();
		const webserver = heldServer(world.runtime, this.name);
		return { world, steppers: this.steppers, registry: () => this.registry(), webserver, verifier: capabilityVerifier(world.runtime, webserver), path: this.path };
	}

	/** The port the endpoint listens on: its own PORT, else the web server's PORT, else MCP_PORT. */
	private port(): number {
		const { moduleOptions } = this.getWorld();
		const own = getStepperOption(this, "PORT", moduleOptions);
		const shared = moduleOptions[WEB_SERVER_PORT_OPTION];
		return Number(own !== undefined ? own : shared !== undefined ? shared : MCP_PORT);
	}

	private async serve() {
		if (this.serving) return;
		const parts = this.parts();
		this.serving = true;
		serveMcp(parts);
		const { eventLogger } = this.getWorld();
		eventLogger.info(`🔗 MCP endpoint registered at ${this.path}`);
		const port = this.port();
		if (listeningPorts().has(port)) return eventLogger.info(`[MCP] WebServer already listening on port ${port} (shared)`);
		await parts.webserver.listen("mcp", port);
		eventLogger.info(`[MCP] WebServer started on port ${port}`);
	}

	steps = {
		serveMcpTools: {
			gwta: `serve mcp tools at {path: ${DOMAIN_ROUTE}}`,
			action: async ({ path }: { path: string }) => {
				this.path = path;
				await this.serve();
				return OK;
			},
		},
	} as const satisfies TStepperSteps;
}
