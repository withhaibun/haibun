import path from "path";

import type { TWorld, TEndFeature, IStepperCycles } from "@haibun/core/lib/execution.js";
import { OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import { actionNotOK, actionOKWithProducts, getFromRuntime, getStepperOption, intOrError, stringOrError } from "@haibun/core/lib/util/index.js";
import { AStepper, type IHasCycles, type IHasOptions } from "@haibun/core/lib/astepper.js";
import { discoverSteps, dispatchStep, validateToolInput, buildSyntheticFeatureStep, parseRpcRequest, StepRegistry } from "@haibun/core/lib/step-dispatch.js";
import { validateStep } from "@haibun/core/lib/step-validation.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { objectCoercer } from "@haibun/core/lib/domains.js";

import { type IWebServer, WEBSERVER, DOMAIN_ENDPOINT, EndpointLabels, EndpointSchema } from "./defs.js";
import { getGrantedCapabilityFromHeaders, validateCapabilityAuthConfig } from "./capability-auth.js";
import { ServerHono, DEFAULT_PORT } from "./server-hono.js";
import { SSETransport, TRANSPORT, type ITransport } from "./sse-transport.js";
import type { IStepTransport } from "./step-transport.js";

function isStepTransport(s: unknown): s is IStepTransport {
	return typeof s === "object" && s !== null && typeof (s as IStepTransport).attach === "function";
}

const cycles = (wss: WebServerStepper): IStepperCycles => ({
	getConcerns: () => ({
		domains: [
			{
				selectors: [DOMAIN_ENDPOINT],
				schema: EndpointSchema,
				coerce: objectCoercer(EndpointSchema),
				description: "HTTP endpoint — route registered on the web server",
				topology: {
					vertexLabel: EndpointLabels.Endpoint,
					type: "as:Service",
					id: "url",
					properties: {
						url: LinkRelations.IDENTIFIER.rel,
						method: LinkRelations.TAG.rel,
						description: LinkRelations.NAME.rel,
						registeredAt: LinkRelations.PUBLISHED.rel,
					},
				},
			},
		],
	}),
	async startFeature() {
		if (wss.webserver) {
			wss.webserver.clearMounted();
		} else {
			const filesBase = path.join(process.cwd(), "files");
			wss.webserver = new ServerHono(wss.world.eventLogger, filesBase);
		}
		wss.getWorld().runtime[WEBSERVER] = wss.webserver;
		wss.getWorld().runtime[TRANSPORT] = new SSETransport(wss.webserver, wss.world.eventLogger);
		await Promise.resolve();
	},
	async endFeature(wtw: TEndFeature) {
		if (wtw.shouldClose) {
			for (const s of wss.steppers) {
				if (isStepTransport(s)) s.detach();
			}
			wss.stepRegistry = undefined;
			await wss.webserver?.close();
			wss.webserver = undefined;
		}
	},
});

class WebServerStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "Serve static files, create directory indexes, and host web content";

	webserver: ServerHono | undefined;
	steppers: AStepper[] = [];
	stepRegistry: StepRegistry | undefined;
	cycles: IStepperCycles = cycles(this);

	options = {
		PORT: {
			desc: `Change web server port from ${DEFAULT_PORT}`,
			parse: (port: string) => intOrError(port),
		},
		INTERFACE: {
			desc: "Change web server interface from default (127.0.0.1). e.g. 0.0.0.0",
			parse: (input: string) => ({ result: input }),
		},
		RPC_ACCESS_TOKEN: {
			desc: "Bearer token used to authorize protected RPC steps",
			parse: (input: string) => stringOrError(input),
		},
		RPC_ACCESS_CAPABILITY: {
			desc: "Capability granted to callers authenticated with RPC_ACCESS_TOKEN",
			parse: (input: string) => stringOrError(input),
		},
	};
	port: number = DEFAULT_PORT;
	hostname?: string;
	rpcAccessToken?: string;
	rpcAccessCapability?: string;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		const sname = this.constructor.name;
		const fromModule = (world.moduleOptions as unknown as Record<string, Record<string, unknown> | undefined>)?.[sname]?.["PORT"];
		const portOption = fromModule || getStepperOption(this, "PORT", world.moduleOptions);
		if (portOption) {
			const parsed = parseInt(String(portOption), 10);
			if (Number.isNaN(parsed) || parsed <= 0) {
				throw new Error(`WebServerStepper: PORT option "${portOption}" must be a positive integer`);
			}
			this.port = parsed;
		}
		const interfaceOption = getStepperOption(this, "INTERFACE", world.moduleOptions);
		if (interfaceOption) {
			this.hostname = String(interfaceOption);
		}
		this.rpcAccessToken = getStepperOption(this, "RPC_ACCESS_TOKEN", world.moduleOptions) as string | undefined;
		this.rpcAccessCapability = getStepperOption(this, "RPC_ACCESS_CAPABILITY", world.moduleOptions) as string | undefined;
		validateCapabilityAuthConfig("WebServerStepper RPC", {
			accessToken: this.rpcAccessToken,
			accessCapability: this.rpcAccessCapability,
		});
	}

	steps = {
		showPorts: {
			gwta: "show ports",
			action: () => {
				const ports = Object.fromEntries(ServerHono.listeningPorts);
				return actionOKWithProducts({ _type: "ServerConfig", _summary: `listening: ${Object.entries(ports).map(([p, w]) => `${p} (${w})`).join(", ")}`, ports });
			},
		},
		isListening: {
			gwta: "webserver is listening for {why}",
			action: async ({ why }: TStepArgs) => {
				await this.listen(String(why));
				return OK;
			},
		},
		showMounts: {
			gwta: "show mounts",
			action: () => {
				const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
				const mounts = webserver.mounted;
				const paths = Object.entries(mounts).flatMap(([method, routes]) => Object.keys(routes).map((p) => `${method.toUpperCase()} ${p}`));
				return actionOKWithProducts({ _type: "ServerConfig", _summary: `${paths.length} mounted routes`, mounts });
			},
		},
		serveFiles: {
			gwta: "serve files from {loc}",
			action: ({ loc, why }: TStepArgs) => {
				try {
					this.webserver?.checkAddStaticFolder(String(loc), "/");
					return OK;
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return actionNotOK(message);
				}
			},
		},
		serveFilesAt: {
			gwta: "serve files at {where} from {loc}",
			action: ({ where, loc }: TStepArgs) => {
				try {
					this.webserver?.checkAddStaticFolder(String(loc), String(where));
					return OK;
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return actionNotOK(message);
				}
			},
		},
		indexFiles: {
			gwta: "index files from {loc}",
			action: ({ loc }: TStepArgs) => {
				try {
					this.webserver?.checkAddIndexFolder(String(loc), "/");
					return OK;
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					return actionNotOK(message);
				}
			},
		},
		showRoutes: {
			gwta: "show routes",
			action: () => {
				const routes = this.webserver?.mounted;
				const paths = Object.entries(routes ?? {}).flatMap(([method, r]) => Object.keys(r).map((p) => `${method.toUpperCase()} ${p}`));
				return actionOKWithProducts({ _type: "ServerConfig", _summary: `${paths.length} routes`, routes });
			},
		},
		enableRpc: {
			gwta: "enable rpc",
			action: () => {
				this.stepRegistry = new StepRegistry(this.steppers, this.getWorld());
				this.attachTransports();

				const transport = getFromRuntime(this.getWorld().runtime, TRANSPORT) as ITransport;
				const logger = this.getWorld().eventLogger;

				transport.onMessage(async (raw: unknown, requestInfo) => {
					const msg = parseRpcRequest(raw);
					if (!msg) return;
					const { method, params } = msg;

					// Introspection methods produce no observations and may be invoked
					// by clients that have no caller seqPath (e.g. a fresh SPA session
					// asking for the stepper catalog). State-changing dispatches MUST
					// carry the caller's seqPath so observations link back to the
					// invoking context — no synthetic [0, N] roots.
					if (method === "step.list") {
						const result = discoverSteps(this.steppers, this.getWorld(), this.stepRegistry);
						this.cacheRpcResponse(method, params, result);
						return result;
					}
					if (method === "step.validate") return validateStep(String(params.text || ""), this.steppers);

					if (!msg.seqPath || msg.seqPath.length === 0) {
						return { error: `${method}: missing seqPath — RPC dispatches must thread the caller's seqPath` };
					}
					const seqPath = msg.seqPath;

					const registry = this.stepRegistry;
					if (!registry) {
						return { error: `${method}: RPC step registry is not initialized` };
					}
					const tool = registry.get(method);
					if (!tool) return { error: `${method}: unknown step method` };

					try {
						const grantedCapability = getGrantedCapabilityFromHeaders(requestInfo?.headers, this.getWorld().runtime, {
							accessToken: this.rpcAccessToken,
							accessCapability: this.rpcAccessCapability,
						});
						const validatedParams = validateToolInput(tool, params as Record<string, unknown>, this.getWorld());
						const featureStep = buildSyntheticFeatureStep(tool, validatedParams, seqPath);
						const hr = await dispatchStep({ registry, world: this.getWorld(), steppers: this.steppers, grantedCapability }, featureStep);
						if (hr.ok) {
							const result = hr.products ?? { ok: true };
							this.cacheRpcResponse(method, params, result);
							return result;
						}
						return { error: `${method}: ${hr.errorMessage}` };
					} catch (err) {
						const detail = err instanceof Error ? err.message : String(err);
						logger.error(`[RPC] ${method}: ${detail}`);
						return { error: `${method}: ${detail}` };
					}
				});
				return OK;
			},
		},
		refreshSteppers: {
			gwta: "refresh steppers",
			exposeMCP: false,
			action: () => {
				if (!this.stepRegistry) return OK;
				this.stepRegistry.refresh(this.steppers, this.getWorld());
				this.attachTransports();
				this.getWorld().eventLogger.info(`[RPC] steppers refreshed: ${this.steppers.length} steppers, ${this.stepRegistry.list().length} tools`);
				return OK;
			},
		},
	};

	/** Call attach() on every IStepTransport in the stepper list. */
	private attachTransports(): void {
		const webserver = this.getWorld().runtime[WEBSERVER] as IWebServer | undefined;
		if (!this.stepRegistry || !webserver) return;
		for (const s of this.steppers) {
			if (isStepTransport(s)) {
				s.attach(this.stepRegistry, webserver);
			}
		}
	}

	async listen(why: string) {
		if (!this.webserver) {
			throw new Error("WebServerStepper: webserver not initialized - ensure startFeature cycle ran");
		}
		if (ServerHono.listeningPorts.has(this.port)) {
			return;
		}
		// Try to stop a previous instance on this port before binding
		try {
			const host = this.hostname || "127.0.0.1";
			const res = await fetch(`http://${host}:${this.port}/stop`, { method: "POST", signal: AbortSignal.timeout(2000) });
			if (res.ok) this.getWorld().eventLogger.info(`Stopped previous instance on port ${this.port}`);
			await new Promise((r) => setTimeout(r, 500));
		} catch {
			/* no previous instance */
		}
		await this.webserver.listen(why, this.port, this.hostname);
	}

	private cacheRpcResponse(method: string, params: Record<string, unknown>, result: unknown): void {
		const cache = (this.getWorld().runtime[RPC_CACHE] ??= {}) as Record<string, unknown>;
		const key = Object.keys(params).length === 0 ? method : `${method}:${JSON.stringify(params)}`;
		cache[key] = result;
	}
}

export const RPC_CACHE = "rpc-cache";

export default WebServerStepper;

export interface IWebServerStepper {
	webserver: IWebServer;
	close: () => void;
}
