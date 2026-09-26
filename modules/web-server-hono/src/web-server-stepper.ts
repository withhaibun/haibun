import path from "path";
import { z } from "zod";

import type { TWorld } from "@haibun/core/lib/world.js";
import { OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import { actionNotOK, actionOKWithProducts, getFromRuntime, getStepperOption, intOrError, errorDetail } from "@haibun/core/lib/util/index.js";
import { AStepper, type IHasCycles, type IHasOptions, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { dispatchStep } from "@haibun/core/lib/step-dispatch.js";
import { ANSWERED_WITHOUT_PRODUCTS, parseRpcRequest, RPC_REFUSED } from "@haibun/core/lib/rpc-wire.js";
import { runWithRequestContext, requestBaseIri } from "@haibun/core/lib/request-context.js";
import { buildFeatureStepForTransport, refusal, runRegistry, type StepRegistry } from "@haibun/core/lib/step-registry.js";
import { actionList, mayCall } from "@haibun/core/lib/actions.js";
import { DOMAIN_TEXT, DOMAIN_FILE_PATH, DOMAIN_ROUTE } from "@haibun/core/lib/domains.js";
import { STORE_METHOD_PREFIX, storeMethods } from "@haibun/core/lib/store-protocol.js";
import { validateToolInput } from "@haibun/core/lib/tool-validation.js";
import { activeSitePrincipal, allocateSyntheticSeqPath, resolveHostId, syntheticSeqPath } from "@haibun/core/lib/host-id.js";
import { SERVING } from "@haibun/core/lib/serving.js";
import { streamContext } from "@haibun/core/lib/step-stream-context.js";
import { HTTP_HOST_LABEL, LinkRelations } from "@haibun/core/lib/resources.js";
import { runReadingAt, runActingAs } from "@haibun/core/lib/capability-context.js";
import { fromJsonText } from "@haibun/core/lib/json-text.js";

import { type IWebServer, WEBSERVER, DOMAIN_ENDPOINT, EndpointLabels, EndpointSchema } from "./defs.js";
import { endWhenLapsed, grantedCapabilityForRequest } from "./capability-auth.js";
import { ServerHono, DEFAULT_PORT } from "./server-hono.js";
import { SSETransport, TRANSPORT, type ITransport } from "./sse-transport.js";
import type { IStepTransport } from "./step-transport.js";

/** What holding authority over this instance's web server means: ending the process that serves it. */
const WEB_SERVER_CAPABILITIES = { stop: "WebServer:stop" } as const;
/** The domain of the ports this process listens on, each with why it listens. */
const DOMAIN_LISTENING_PORTS = "listening-ports";
const ListeningPortsSchema = z.object({ ports: z.record(z.string(), z.string()) });
const listeningSummary = (p: Record<string, unknown>) =>
	`listening: ${Object.entries(p.ports as Record<string, string>)
		.map(([port, why]) => `${port} (${why})`)
		.join(", ")}`;

const cycles = (wss: WebServerStepper): IStepperCycles => ({
	getConcerns: () => ({
		domains: [
			{
				selectors: [DOMAIN_ENDPOINT],
				schema: fromJsonText(EndpointSchema),
				description: "HTTP endpoint, route registered on the web server",
				topology: {
					persistedAs: EndpointLabels.Endpoint,
					type: "as:Service",
					instrumentation: true,
					id: "url",
					properties: {
						url: LinkRelations.IDENTIFIER.rel,
						method: LinkRelations.TAG.rel,
						description: LinkRelations.NAME.rel,
						endpointClass: LinkRelations.TAG.rel,
						generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
					},
					// An endpoint is part of the host that serves it, which a request observed reaching it names.
					edges: { isPartOf: { rel: LinkRelations.PART_OF.rel, range: HTTP_HOST_LABEL } },
					// url is the endpoint's identity: the natural lookup filter (strings are queryable only by manual opt-in).
					sortColumns: { url: "TEXT" },
				},
			},
			{ selectors: [DOMAIN_LISTENING_PORTS], schema: ListeningPortsSchema, description: "The ports this process listens on, each with why", ui: { summary: listeningSummary } },
		],
	}),
	async startFeature() {
		if (wss.webserver) {
			wss.webserver.clearMounted();
		} else {
			const filesBase = path.join(process.cwd(), "files");
			wss.webserver = new ServerHono(wss.world.eventLogger, filesBase, () => wss.getWorld().shared.getStore(), wss.allowedWithoutDelegation);
		}
		// The delegated store surface: a sibling instance keeping its records in this instance's store. Reached only once RPC
		// is enabled, since only the RPC transport calls a family's methods.
		wss.webserver.addRpcMethods(
			STORE_METHOD_PREFIX,
			{ description: "This instance's store, for an instance delegated to keep its records here" },
			storeMethods(() => wss.getWorld().shared.getStore()),
		);
		wss.getWorld().runtime[WEBSERVER] = wss.webserver;
		wss.getWorld().runtime[TRANSPORT] = new SSETransport(wss.webserver, wss.world.eventLogger, wss.getWorld().runtime);
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
		ALLOW_WITHOUT_DELEGATION: {
			desc: "Actions every caller may take without a delegation, comma-separated, beside what its delegation allows: Read:public for a site anyone may read. Unset, a caller holds only what it proves, and one that proves nothing may call only a step that requires nothing",
			parse: (input: string) => (actionList(input).length > 0 ? { result: input } : { parseError: "ALLOW_WITHOUT_DELEGATION: name at least one action, comma-separated" }),
		},
	};
	port: number = DEFAULT_PORT;
	hostname?: string;
	/** The actions every caller may take without a delegation. */
	allowedWithoutDelegation: string[] = [];

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
		this.allowedWithoutDelegation = actionList(getStepperOption(this, "ALLOW_WITHOUT_DELEGATION", world.moduleOptions));
	}

	steps = {
		stopInstance: {
			gwta: `stop this instance because {reason: ${DOMAIN_TEXT}}`,
			capability: WEB_SERVER_CAPABILITIES.stop,
			description: "End this instance's process, stating why, so its log says what stopped it.",
			action: ({ reason }: { reason: string }) => {
				this.getWorld().eventLogger.info(`stopping this instance: ${reason}`);
				// The signal is deferred so the answer is sent first, and SIGTERM rather than exit, so every shutdown handler
				// runs: a persistent store flushing its write-ahead log would be corrupted by an exit that skipped it.
				setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
				return OK;
			},
		},
		showPorts: {
			gwta: "show ports",
			productsDomain: DOMAIN_LISTENING_PORTS,
			action: () => actionOKWithProducts({ ports: Object.fromEntries(ServerHono.listeningPorts) }),
		},
		isListening: {
			gwta: `webserver is listening for {why: ${DOMAIN_TEXT}}`,
			action: async ({ why }: TStepArgs) => {
				await this.listen(String(why));
				return OK;
			},
		},
		serveFiles: {
			gwta: `serve files from {loc: ${DOMAIN_FILE_PATH}}`,
			action: ({ loc }: TStepArgs) => {
				try {
					this.webserver?.checkAddStaticFolder(String(loc), "/", { description: `Files from ${loc}` });
					return OK;
				} catch (e) {
					const message = errorDetail(e);
					return actionNotOK(message);
				}
			},
		},
		serveFilesAt: {
			gwta: `serve files at {where: ${DOMAIN_ROUTE}} from {loc: ${DOMAIN_FILE_PATH}}`,
			action: ({ where, loc }: TStepArgs) => {
				try {
					this.webserver?.checkAddStaticFolder(String(loc), String(where), { description: `Files from ${loc}` });
					return OK;
				} catch (e) {
					const message = errorDetail(e);
					return actionNotOK(message);
				}
			},
		},
		indexFiles: {
			gwta: `index files from {loc: ${DOMAIN_FILE_PATH}}`,
			action: ({ loc }: TStepArgs) => {
				try {
					this.webserver?.checkAddIndexFolder(String(loc), "/", { description: `An index of the files in ${loc}` });
					return OK;
				} catch (e) {
					const message = errorDetail(e);
					return actionNotOK(message);
				}
			},
		},
		enableRpc: {
			gwta: "enable rpc",
			action: () => {
				// The run's own registry, which holds what the run's transports injected, so a caller reaching the run by RPC
				// dispatches and discovers the same steps as every other caller of the run.
				this.stepRegistry = runRegistry(this.getWorld());

				const transport = getFromRuntime(this.getWorld().runtime, TRANSPORT) as ITransport;
				// What the registry answers is which methods are reads, which the transport asks before narrating that it
				// served a call: reading a run is not an act of the run, so serving a read is not announced as one.
				(transport as Partial<IStepTransport>).attach?.(this.stepRegistry, this.getWorld().runtime[WEBSERVER] as IWebServer);
				const logger = this.getWorld().eventLogger;

				transport.onMessage(async (raw: unknown, requestInfo) => {
					const msg = parseRpcRequest(raw);
					if (!msg) return;
					const { method, params } = msg;

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

					const authority = await grantedCapabilityForRequest(requestInfo, this.getWorld().runtime, this.allowedWithoutDelegation);
					const { granted, principal, refused } = authority;
					if (refused) return { error: `${method}: ${refused}`, [RPC_REFUSED]: true };
					// A streamed call is held open only while the authority it was allowed under holds.
					const stream = streamContext.getStore();
					if (stream) endWhenLapsed(this.getWorld().runtime, authority, stream.signal, stream.end);

					// A method of a served family: gated by the action it declares, verified through the path a step's capability
					// is, with no ungated default.
					const served = this.webserver?.rpcMethod(method);
					if (served) {
						if (!mayCall(granted, { capability: served.action })) return { error: refusal(method, served.action, principal) };
						try {
							// Whoever proved themselves at this boundary is who acts inside it, as in a dispatched step.
							return await runActingAs(principal, () => served.handle((params ?? {}) as Record<string, unknown>));
						} catch (err) {
							return { error: `${method}: ${errorDetail(err)}` };
						}
					}

					const world = this.getWorld();
					const registry = this.stepRegistry;
					if (!registry) {
						return { error: `${method}: RPC step registry is not initialized` };
					}

					try {
						// A call is refused before its input is read, and alike whether its step exists, so a refusal tells the caller
						// nothing of the steps it may not call.
						const tool = registry.get(method);
						if (!tool || !mayCall(granted, tool.descriptor)) return { error: refusal(method, tool?.descriptor.capability, principal) };
						// External callers (no feature-step context) get a server-synthesised seqPath, matching MCP.
						const seqPath = msg.seqPath && msg.seqPath.length > 0 ? msg.seqPath : allocateSyntheticSeqPath(world);
						const validatedParams = validateToolInput(seqPath, tool, params as Record<string, unknown>, world);
						const featureStep = buildFeatureStepForTransport(tool, validatedParams, seqPath);
						// RPC dispatches are SPA-initiated (constant polling like getClusteredQuads), not feature steps;
						// log them at trace so they don't bury the run's own steps in the timeline. Still visible at debug.
						featureStep.isSubStep = true;
						// Whoever proved themselves at this boundary is who acts inside it, so what a step records names the
						// reader who asked for it rather than the process that carried it out. What it reads is bounded by the read it
						// holds, in dispatch, and by the level the call asked to read at, which can only be narrower.
						const hr = await runWithRequestContext({ baseIri: requestBaseIri(requestInfo?.headers) }, () =>
							// A request holds what it presented and nothing else: the server was started inside a step of the run, and
							// what that step held is no caller's.
							runActingAs(principal, () => runReadingAt(msg.readingAt, () => dispatchStep({ registry, world, steppers: this.steppers, grantedCapability: granted }, featureStep))),
						);
						if (hr.ok) return hr.products ?? ANSWERED_WITHOUT_PRODUCTS;
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
		// A held port fails the bind, naming what holds it: only whoever holds the authority to stop an instance may stop it.
		await this.webserver.listen(why, this.port, this.hostname);
	}
}

export default WebServerStepper;

