import path from "path";

import type { TWorld } from "@haibun/core/lib/world.js";
import { OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import { actionNotOK, actionOKWithProducts, getFromRuntime, getStepperOption, intOrError, stringOrError, errorDetail, optionOrError } from "@haibun/core/lib/util/index.js";
import { AStepper, type IHasCycles, type IHasOptions, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { dispatchStep } from "@haibun/core/lib/step-dispatch.js";
import { parseRpcRequest } from "@haibun/core/lib/rpc-wire.js";
import { runWithRequestContext, requestBaseIri } from "@haibun/core/lib/request-context.js";
import { discoverSteps, buildFeatureStepForTransport, StepRegistry, capabilityAllows } from "@haibun/core/lib/step-registry.js";
import { handleStoreCall, isStoreMethod, requiredStoreCapability } from "@haibun/core/lib/store-protocol.js";
import { validateToolInput } from "@haibun/core/lib/tool-validation.js";
import { activeSitePrincipal, allocateSyntheticSeqPath, resolveHostId, syntheticSeqPath } from "@haibun/core/lib/host-id.js";
import { SERVING } from "@haibun/core/lib/serving.js";
import { validateStep } from "@haibun/core/lib/step-validation.js";
import { AccessLevelSchema, LinkRelations, narrowerCeiling, type AccessLevel } from "@haibun/core/lib/resources.js";
import { runReadingAt, runActingAs } from "@haibun/core/lib/capability-context.js";
import { objectCoercer } from "@haibun/core/lib/domains.js";

import { type IWebServer, WEBSERVER, DOMAIN_ENDPOINT, EndpointLabels, EndpointSchema } from "./defs.js";
import { grantedCapabilityForRequest, validateCapabilityAuthConfig } from "./capability-auth.js";
import { ServerHono, DEFAULT_PORT } from "./server-hono.js";
import { SSETransport, TRANSPORT, type ITransport } from "./sse-transport.js";
import { attachTransportsToRegistry } from "@haibun/core/phases/Executor.js";
import type { IStepTransport } from "./step-transport.js";

const cycles = (wss: WebServerStepper): IStepperCycles => ({
	getConcerns: () => ({
		domains: [
			{
				selectors: [DOMAIN_ENDPOINT],
				schema: EndpointSchema,
				coerce: objectCoercer(EndpointSchema),
				description: "HTTP endpoint, route registered on the web server",
				topology: {
					persistedAs: EndpointLabels.Endpoint,
					type: "as:Service",
					id: "url",
					properties: {
						url: LinkRelations.IDENTIFIER.rel,
						method: LinkRelations.TAG.rel,
						description: LinkRelations.NAME.rel,
						endpointClass: LinkRelations.TAG.rel,
						generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
					},
					// url is the endpoint's identity: the natural lookup filter (strings are queryable only by manual opt-in).
					sortColumns: { url: "TEXT" },
				},
			},
		],
	}),
	async startFeature() {
		if (wss.webserver) {
			wss.webserver.clearMounted();
		} else {
			const filesBase = path.join(process.cwd(), "files");
			wss.webserver = new ServerHono(wss.world.eventLogger, filesBase, () => wss.getWorld().shared.getStore());
		}
		wss.getWorld().runtime[WEBSERVER] = wss.webserver;
		wss.getWorld().runtime[TRANSPORT] = new SSETransport(wss.webserver, wss.world.eventLogger);
		await Promise.resolve();
	},
	async endFeature(wtw: TEndFeature) {
		if (wtw.shouldClose) {
			for (const s of wss.steppers) {
				const candidate = s as unknown as { detach?: () => void };
				if (typeof candidate.detach === "function") candidate.detach();
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
			// A port is one process's: a process that starts another gives the child its own, or lets it take the default.
			perProcess: true,
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
		READ_CEILING: {
			desc: `The most a caller reaching this server may see, whatever any step it calls asks for: one of ${AccessLevelSchema.options.join(", ")}. Unset means the run's own level, which is every record it holds; a deployment reachable by anyone states a narrower one.`,
			parse: (input: string) => optionOrError(input, [...AccessLevelSchema.options]),
		},
	};
	port: number = DEFAULT_PORT;
	hostname?: string;
	rpcAccessToken?: string;
	rpcAccessCapability?: string;
	/** What a caller reaching this server may see at most; unset leaves the run's own level in force. */
	readCeiling?: AccessLevel;

	/** Monotonic counter for session-allocated seqPath roots. Never resets while process runs. */
	private sessionActionSeq = 0;

	/**
	 * Allocate a new seqPath root for a client session action. Uses this
	 * host's hostId + SYNTHETIC_FEATURE_NUM so session paths sort
	 * distinctly from feature paths and remain globally unique across
	 * client reloads (counter is process-lifetime).
	 */
	private allocateSessionSeqPath(): number[] {
		this.sessionActionSeq += 1;
		return syntheticSeqPath(resolveHostId(), this.sessionActionSeq);
	}

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
		// An unreadable ceiling is not a ceiling: unset is the widest setting, so a misspelling that fell back to it
		// would open the server rather than stop the run.
		const ceiling = getStepperOption(this, "READ_CEILING", world.moduleOptions);
		this.readCeiling = ceiling === undefined ? undefined : AccessLevelSchema.parse(ceiling);
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
				return actionOKWithProducts({
					_type: "ServerConfig",
					_summary: `listening: ${Object.entries(ports)
						.map(([p, w]) => `${p} (${w})`)
						.join(", ")}`,
					ports,
				});
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
			action: ({ loc }: TStepArgs) => {
				try {
					this.webserver?.checkAddStaticFolder(String(loc), "/");
					return OK;
				} catch (e) {
					const message = errorDetail(e);
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
					const message = errorDetail(e);
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
					const message = errorDetail(e);
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
				attachTransportsToRegistry(this.steppers, this.stepRegistry, this.getWorld().runtime[WEBSERVER]);

				const transport = getFromRuntime(this.getWorld().runtime, TRANSPORT) as ITransport;
				// What the registry answers is which methods are reads, which the transport asks before narrating that it
				// served a call: reading a run is not an act of the run, so serving a read is not announced as one.
				(transport as Partial<IStepTransport>).attach?.(this.stepRegistry, this.getWorld().runtime[WEBSERVER] as IWebServer);
				const logger = this.getWorld().eventLogger;

				transport.onMessage(async (raw: unknown, requestInfo) => {
					const msg = parseRpcRequest(raw);
					if (!msg) return;
					const { method, params } = msg;

					// Introspection methods produce no observations and may be invoked
					// by clients that have no caller seqPath (e.g. a fresh SPA session
					// asking for the stepper catalog). State-changing dispatches MUST
					// carry the caller's seqPath so observations link back to the
					// invoking context: no synthetic [0, N] roots.
					if (method === "step.list") {
						// Capability-filter the manifest: an LLM or other scoped
						// caller should see only the tools it can
						// invoke. An absent capability header means unscoped: the full manifest.
						const { granted: grantedCapability } = await grantedCapabilityForRequest(requestInfo, this.getWorld().runtime, {
							accessToken: this.rpcAccessToken,
							accessCapability: this.rpcAccessCapability,
						});
						const result = discoverSteps(this.steppers, this.getWorld(), this.stepRegistry, { grantedCapability });
						// Held for whatever writes a record of this run: what a page was served is what a reader of that record
						// is given, capability-filtered as this caller saw it, rather than a fuller manifest built later.
						this.getWorld().runtime[DISCOVERY_RESPONSE] = result;
						return result;
					}
					if (method === "step.validate") return validateStep(String(params.text || ""), this.steppers);

					// Action bootstrap: client asks for a globally-unique seqPath
					// root before issuing any state-changing RPC. Returns the
					// root; client appends monotonic sub-seqs for each call
					// within the action scope.
					if (method === "action.begin") {
						const seqPath = this.allocateSessionSeqPath();
						// seqPath[0] is the hostId; returning it explicitly saves remote
						// callers from having to reach into the seqPath to learn which
						// host they're talking to. `site` is this instance's site
						// principal: the federation handshake reads it to stamp and
						// de-collide merged reads.
						// `serving` reports whether this instance's feature has finished setting up (see the SERVING runtime key), so a
						// caller can wait for the instance rather than for its port.
						return { seqPath, hostId: seqPath[0], site: activeSitePrincipal(this.getWorld()), serving: this.getWorld().runtime[SERVING] === true };
					}

					// The delegated store surface (store.*): a sibling instance keeping its records in THIS instance's
					// store. Always capability-gated, store.read/store.write by method, no ungated default, because it
					// is full store access for a trusted delegate, distinct from the accessLevel-gated hypermedia surface.
					if (isStoreMethod(method)) {
						const { granted: grantedCapability } = await grantedCapabilityForRequest(requestInfo, this.getWorld().runtime, {
							accessToken: this.rpcAccessToken,
							accessCapability: this.rpcAccessCapability,
						});
						const required = requiredStoreCapability(method);
						if (!capabilityAllows(grantedCapability, required)) return { error: `${method}: capability ${required} required` };
						try {
							return await handleStoreCall(this.getWorld().shared.getStore(), method, params);
						} catch (err) {
							return { error: `${method}: ${errorDetail(err)}` };
						}
					}

					// External callers (no feature-step context) get a server-synthesised seqPath, matching MCP.
					const world = this.getWorld();
					const seqPath = msg.seqPath && msg.seqPath.length > 0 ? msg.seqPath : allocateSyntheticSeqPath(world);

					const registry = this.stepRegistry;
					if (!registry) {
						return { error: `${method}: RPC step registry is not initialized` };
					}
					const tool = registry.get(method);
					if (!tool) return { error: `${method}: unknown step method` };

					try {
						const { granted: grantedCapability, principal } = await grantedCapabilityForRequest(requestInfo, world.runtime, {
							accessToken: this.rpcAccessToken,
							accessCapability: this.rpcAccessCapability,
						});
						const validatedParams = validateToolInput(seqPath, tool, params as Record<string, unknown>, world);
						const featureStep = buildFeatureStepForTransport(tool, validatedParams, seqPath);
						// RPC dispatches are SPA-initiated (constant polling like getClusteredQuads), not feature steps;
						// log them at trace so they don't bury the run's own steps in the timeline. Still visible at debug.
						featureStep.isSubStep = true;
						// What this caller may see, stated once for the whole dispatch: the server's ceiling met with what the
						// call asked for, narrower winning. Every read inside is bounded by it without naming it.
						const ceiling = narrowerCeiling(this.readCeiling, msg.readingAt);
						// Whoever proved themselves at this boundary is who acts inside it, so what a step records names the
						// reader who asked for it rather than the process that carried it out.
						const hr = await runWithRequestContext({ baseIri: requestBaseIri(requestInfo?.headers) }, () =>
							runActingAs(principal, () => runReadingAt(ceiling, () => dispatchStep({ registry, world, steppers: this.steppers, grantedCapability }, featureStep))),
						);
						if (hr.ok) return hr.products ?? { ok: true };
						return { error: `${method}: ${hr.errorMessage}` };
					} catch (err) {
						const detail = errorDetail(err);
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
				this.getWorld().eventLogger.info(`[RPC] steppers refreshed: ${this.steppers.length} steppers, ${this.stepRegistry.size} tools`);
				return OK;
			},
		},
	};

	async listen(why: string) {
		if (!this.webserver) {
			throw new Error("WebServerStepper: webserver not initialized - ensure startFeature cycle ran");
		}
		if (ServerHono.listeningPorts.has(this.port)) {
			return;
		}
		// Try to stop a previous instance on this port before binding. The new
		// instance's `why` becomes the reason on the prior /stop so logs identify
		// who took the port.
		try {
			const host = this.hostname || "127.0.0.1";
			const reason = `port-claim-by ${why}`;
			const res = await fetch(`http://${host}:${this.port}/stop`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason }),
				signal: AbortSignal.timeout(2000),
			});
			if (res.ok) this.getWorld().eventLogger.info(`Stopped previous instance on port ${this.port} for ${why}`);
			await new Promise((r) => setTimeout(r, 500));
		} catch {
			/* no previous instance */
		}
		await this.webserver.listen(why, this.port, this.hostname);
	}
}

/** Runtime key holding the step discovery response this server last served, for whatever writes a record of the run. */
export const DISCOVERY_RESPONSE = "discovery-response";

export default WebServerStepper;

export interface IWebServerStepper {
	webserver: IWebServer;
	close: () => void;
}
