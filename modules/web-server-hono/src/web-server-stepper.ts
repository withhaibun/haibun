import type { TWorld } from "@haibun/core/lib/world.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { actionNotOK, getStepperOptionName, intOrError, boolOrError, errorDetail } from "@haibun/core/lib/domains/util.js";
import { AStepper, CycleWhen, type IHasCycles, type IHasOptions, type TEndActuality, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { actionList } from "@haibun/core/lib/domains/actions.js";
import { DOMAIN_TEXT, DOMAIN_FILE_PATH, DOMAIN_ROUTE, DOMAIN_LINK } from "@haibun/core/lib/domains/domains.js";
import { STORE_METHOD_PREFIX, storeMethods } from "@haibun/core/lib/domains/store-protocol.js";
import { basicAuthUsers } from "@haibun/core/lib/domains/basic-auth.js";
import type { IWebServer, MiddlewareHandler, TRoutePurpose } from "./ports.js";
import { TRANSPORT, type ITransport } from "./domains/transport.js";
import { DEFAULT_PORT, endpointDomainDefinition, originList, WEB_SERVER_CAPABILITIES } from "./domains/web-server.js";
import { FOLLOWER_WRITES_IN_FLIGHT } from "./machines/follower.js";
import { capabilityVerifier } from "./pipelines/capability-verifier.js";
import { SSETransport } from "./pipelines/event-stream.js";
import { serveRpc } from "./pipelines/serve-rpc.js";
import { servedFolderGates } from "./pipelines/served-folder.js";
import { serverSettings, type TServing } from "./pipelines/server-settings.js";
import { heldServer, holdServer, listeningPorts, newServer, stopProcess, whyNotSignedIn } from "./root.js";
import { declareSteps } from "@haibun/core/lib/steps/domains/stepper.js";

const cycles = (wss: WebServerStepper): IStepperCycles => ({
	getConcerns: () => ({ domains: [endpointDomainDefinition] }),
	async startFeature() {
		const { runtime } = wss.getWorld();
		if (wss.webserver === undefined) wss.webserver = wss.newServer();
		else wss.webserver.clearMounted();
		const webserver = wss.webserver;
		// The delegated store surface: a sibling instance keeping its records in this instance's store. It is reached only
		// where the server serves RPC, since only the RPC transport calls a family's methods.
		webserver.addRpcMethods(
			STORE_METHOD_PREFIX,
			{ description: "This instance's store, for an instance delegated to keep its records here" },
			storeMethods(() => wss.getWorld().shared.getStore()),
		);
		holdServer(runtime, webserver);
		const transport = wss.eventStream(webserver);
		runtime[TRANSPORT] = transport;
		if (wss.rpc) wss.stepRegistry = wss.serveRpc(webserver, transport);
		await Promise.resolve();
	},
	// A server that lasts the whole of actuality closes as it ends, unless actuality stays.
	async endActuality({ stays }: TEndActuality) {
		if (stays) return;
		await Promise.all(wss.actualityServers.map((server) => server.close()));
		wss.actualityServers = [];
	},
	async endFeature(wtw: TEndFeature) {
		if (!wtw.shouldClose) return;
		for (const s of wss.steppers) if ("detach" in s && typeof s.detach === "function") s.detach();
		wss.stepRegistry = undefined;
		await wss.webserver?.close();
		wss.webserver = undefined;
	},
});

class WebServerStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "Serve static files, create directory indexes, and host web content";
	/** Each feature's server is made before another stepper starts its feature, so a stepper serves on it as its feature starts. */
	cyclesWhen = { startFeature: CycleWhen.FIRST - 2 };

	webserver: IWebServer | undefined;
	steppers: AStepper[] = [];
	stepRegistry: StepRegistry | undefined;
	cycles: IStepperCycles = cycles(this);

	options = {
		PORT: {
			desc: `Change web server port from ${DEFAULT_PORT}`,
			// A port is one process's: a process that starts another gives the child its own, or lets it take the default.
			perProcess: true,
			parse: (port: string) => intOrError(port),
		},
		INTERFACE: { desc: "Change web server interface from default (127.0.0.1). e.g. 0.0.0.0", parse: (input: string) => ({ result: input }) },
		ORIGINS: {
			desc: "Each address of the server, with its scheme, comma-separated, such as https://example.org. The server serves a request addressed to the host of one of these, and in development also to a loopback name; a proxy's forwarded host is read only where it names one, and /mcp allows a cross-origin call from a page served at one. Required in production (NODE_ENV=production)",
			parse: (input: string) => {
				try {
					originList(input);
					return { result: input };
				} catch (e) {
					return { parseError: `ORIGINS: ${errorDetail(e)}` };
				}
			},
		},
		ALLOW_WITHOUT_DELEGATION: {
			// An instance a run launches states what it allows in its own configuration, rather than holding its launcher's.
			perProcess: true,
			desc: "Actions every caller may take without a delegation, comma-separated, beside what its delegation allows: Read:public for a site anyone may read. Unset, a caller holds only what it proves, and one that doesn't prove a key may call only a step that doesn't require an action",
			parse: (input: string) => (actionList(input).length > 0 ? { result: input } : { parseError: "ALLOW_WITHOUT_DELEGATION: name at least one action, comma-separated" }),
		},
		RPC: {
			desc: "Serve RPC calls to actuality's steps on each feature's server from the feature's start: true or false. A file of a folder a step serves then carries the artifact policy, so a page among the files doesn't run a script. Unset, the server doesn't serve RPC",
			parse: (input: string) => boolOrError(input),
		},
		BASIC_AUTH: {
			desc: "Require HTTP basic auth on every route, as a proxy's basic auth does: user:password entries, comma-separated. A request that doesn't sign in is refused 401 before anything else reads it. Unset, the server admits every visitor",
			parse: (input: string) => {
				try {
					basicAuthUsers(input);
					return { result: input };
				} catch (e) {
					return { parseError: `BASIC_AUTH: ${errorDetail(e)}` };
				}
			},
		},
	};
	port: number = DEFAULT_PORT;
	hostname?: string;
	/** The origins each feature's server is reached at, what every caller may do without a delegation, and whom every route admits by HTTP basic auth. */
	serving: TServing = { origins: [], allowedWithoutDelegation: [], admitted: [] };
	/** Whether each feature's server serves RPC calls to actuality's steps. */
	rpc = false;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		const settings = serverSettings(this, world.moduleOptions);
		this.port = settings.port;
		this.hostname = settings.hostname;
		this.serving = settings.serving;
		this.rpc = settings.rpc;
	}

	steps = declareSteps({
		stopInstance: {
			gwta: `stop this instance because {reason: ${DOMAIN_TEXT}}`,
			capability: WEB_SERVER_CAPABILITIES.stop,
			description: "Ends this instance's process, stating why, so its log records what stopped it.",
			action: ({ reason }) => {
				this.getWorld().eventLogger.info(`stopping this instance: ${reason}`);
				stopProcess();
				return OK;
			},
		},
		asksToSignIn: {
			gwta: `every visitor to {address: ${DOMAIN_LINK}} is asked to sign in`,
			description: "Check that an address refuses a request that doesn't sign in, as a site behind basic auth does. It fails with what the address returned and what to change.",
			action: async ({ address }) => {
				const why = await whyNotSignedIn(address);
				return why ? actionNotOK(why) : OK;
			},
		},
		isListening: {
			gwta: `webserver is listening for {why: ${DOMAIN_TEXT}}`,
			description:
				"Starts the feature's web server listening on its port, and passes where the port is held, since the server already listens. The step records why the server listens, which a call that finds the port held states.",
			action: async ({ why }) => {
				await this.listen(why);
				return OK;
			},
		},
		serveFilesAt: {
			gwta: `serve files at {where: ${DOMAIN_ROUTE}} from {loc: ${DOMAIN_FILE_PATH}}`,
			description:
				"Serves the files of the directory on the feature's web server under the route, with the read each file requires and the artifact policy while the server dispatches `/rpc` calls, as the RPC option states. Fails, stating why the files weren't served, where the mount is refused.",
			action: ({ where, loc }) =>
				this.mounting(`the files of ${loc} at ${where}`, (server) => server.checkAddStaticFolder(loc, where, filesFrom(loc), ...this.servedFolderGates(server))),
		},
		indexFiles: {
			gwta: `index files from {loc: ${DOMAIN_FILE_PATH}}`,
			description:
				"Serves an index of the files in the directory on the feature's web server at the root, with the read each file requires and the artifact policy while the server dispatches `/rpc` calls, as the RPC option states. Fails, stating why the index wasn't served, where the mount is refused.",
			action: ({ loc }) =>
				this.mounting(`an index of ${loc}`, (server) =>
					server.checkAddIndexFolder(loc, "/", { description: `An index of the files in ${loc}` }, ...this.servedFolderGates(server)),
				),
		},
	});

	/** The feature's server, which its start cycle made. */
	private server(): IWebServer {
		return heldServer(this.getWorld().runtime, "WebServerStepper");
	}

	/** Mounts what a step serves on the feature's server, failing the step with why where the mount is refused. */
	private mounting(what: string, mount: (server: IWebServer) => void) {
		try {
			mount(this.server());
			return OK;
		} catch (e) {
			return actionNotOK(`${what} weren't served: ${errorDetail(e)}`);
		}
	}

	/** The middleware each request for a file of a folder a step serves on `server` passes: the read the file requires, and the
	 *  artifact policy while the feature's server dispatches `/rpc` calls, as the RPC option states. */
	private servedFolderGates(server: IWebServer): MiddlewareHandler[] {
		const allowingOption = getStepperOptionName(this, "ALLOW_WITHOUT_DELEGATION");
		return servedFolderGates({ runtime: this.getWorld().runtime, served: server, allowingOption, dispatchesRpc: () => this.stepRegistry !== undefined });
	}

	/** A server for this instance: its files, its store, and who it admits, as every server of this instance has them. */
	newServer(): IWebServer {
		return newServer(this.getWorld(), this.serving);
	}

	/** The event stream of `server`, and the `/rpc` calls it carries, each request verified through actuality's authority. */
	eventStream(server: IWebServer): SSETransport {
		const { eventLogger, runtime } = this.getWorld();
		return new SSETransport({ webserver: server, eventLogger, runtime, verifier: capabilityVerifier(runtime, server), writesInFlight: FOLLOWER_WRITES_IN_FLIGHT });
	}

	/** The servers that last the whole of actuality, apart from each feature's. */
	actualityServers: IWebServer[] = [];

	/** A server of this instance that lasts the whole of actuality, apart from each feature's: it serves RPC, carries its
	 *  own event stream, serves what `mount` adds, and closes as actuality ends unless actuality stays. */
	async serveForActuality(why: string, port: number, mount: (server: IWebServer) => void): Promise<ITransport> {
		const server = this.newServer();
		const transport = this.eventStream(server);
		this.serveRpc(server, transport);
		mount(server);
		await server.listen(why, port, this.hostname);
		this.actualityServers.push(server);
		return transport;
	}

	/** Serves RPC calls to actuality's steps on a server's transport, under the authority each request presents, and returns
	 *  the registry that dispatches them. */
	serveRpc(webserver: IWebServer, transport: ITransport): StepRegistry {
		const { runtime } = this.getWorld();
		const verifier = capabilityVerifier(runtime, webserver);
		return serveRpc({ world: this.getWorld(), steppers: this.steppers, webserver, transport, verifier });
	}

	async listen(why: string) {
		if (!this.webserver) throw new Error("WebServerStepper: the web server isn't made yet; its feature's start cycle makes it, so listen within a feature");
		if (listeningPorts().has(this.port)) return;
		// A held port fails the bind, naming what holds it: only whoever holds the authority to stop an instance may stop it.
		await this.webserver.listen(why, this.port, this.hostname);
	}
}

/** The purpose of a folder of files a step serves. */
const filesFrom = (loc: string): TRoutePurpose => ({ description: `Files from ${loc}` });

export default WebServerStepper;
