import path from "path";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { z } from "zod";

import type { TWorld } from "@haibun/core/lib/world.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { actionNotOK, actionOKWithProducts, getFromRuntime, getStepperOption, intOrError, errorDetail } from "@haibun/core/lib/util/index.js";
import { AStepper, type IHasCycles, type IHasOptions, type TEndFeature, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { dispatchStep } from "@haibun/core/lib/step-dispatch.js";
import { ACTION_BEGIN, ANSWERED_WITHOUT_PRODUCTS, parseRpcRequest, authorityRefusal, stepFailed, RPC_PROTOCOL, type THandshake } from "@haibun/core/lib/rpc-wire.js";
import { runWithRequestContext, requestBaseIri } from "@haibun/core/lib/request-context.js";
import { buildFeatureStepForTransport, refusal, runRegistry, type StepRegistry } from "@haibun/core/lib/step-registry.js";
import { actionList, lackedAction, mayCall } from "@haibun/core/lib/actions.js";
import { DOMAIN_TEXT, DOMAIN_FILE_PATH, DOMAIN_ROUTE, DOMAIN_LINK } from "@haibun/core/lib/domains.js";
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
import { whyNotSignedInOnly } from "./auth.js";
import { basicAuthUsers, type TBasicAuthUser } from "@haibun/core/lib/basic-auth.js";
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
			wss.webserver = new ServerHono(wss.getWorld().eventLogger, filesBase, () => wss.getWorld().shared.getStore(), wss.allowedWithoutDelegation, wss.admitted);
		}
		// The delegated store surface: a sibling instance keeping its records in this instance's store. Reached only once RPC
		// is enabled, since only the RPC transport calls a family's methods.
		wss.webserver.addRpcMethods(
			STORE_METHOD_PREFIX,
			{ description: "This instance's store, for an instance delegated to keep its records here" },
			storeMethods(() => wss.getWorld().shared.getStore()),
		);
		wss.getWorld().runtime[WEBSERVER] = wss.webserver;
		wss.getWorld().runtime[TRANSPORT] = new SSETransport(wss.webserver, wss.getWorld().eventLogger, wss.getWorld().runtime);
		await Promise.resolve();
	},
	async endFeature(wtw: TEndFeature) {
		if (wtw.shouldClose) {
			for (const s of wss.steppers) if ("detach" in s && typeof s.detach === "function") s.detach();
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
			desc: "Actions every caller may take without a delegation, comma-separated, beside what its delegation allows: Read:public for a site anyone may read. Unset, a caller holds only what it proves, and one that doesn't prove a key may call only a step that doesn't require an action",
			parse: (input: string) => (actionList(input).length > 0 ? { result: input } : { parseError: "ALLOW_WITHOUT_DELEGATION: name at least one action, comma-separated" }),
		},
		BASIC_AUTH: {
			desc: "Require HTTP basic auth on every route, as a proxy's basic auth does: user:password entries, comma-separated. A request that doesn't sign in is refused 401 before anything else reads it. Unset, the server doesn't ask",
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
	/** The actions every caller may take without a delegation. */
	allowedWithoutDelegation: string[] = [];
	/** The people every route admits by HTTP basic auth. */
	admitted: TBasicAuthUser[] = [];

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
		const portOption = getStepperOption(this, "PORT", world.moduleOptions);
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
		const basicAuth = getStepperOption(this, "BASIC_AUTH", world.moduleOptions);
		this.admitted = basicAuth ? basicAuthUsers(basicAuth) : [];
	}

	steps = {
		stopInstance: {
			gwta: `stop this instance because {reason: ${DOMAIN_TEXT}}`,
			capability: WEB_SERVER_CAPABILITIES.stop,
			description: "End this instance's process, stating why, so its log records what stopped it.",
			action: ({ reason }: { reason: string }) => {
				this.getWorld().eventLogger.info(`stopping this instance: ${reason}`);
				// The signal is deferred so the answer is sent first, and SIGTERM rather than exit, so every shutdown handler
				// runs: a persistent store flushing its write-ahead log would be corrupted by an exit that skipped it.
				setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
				return OK;
			},
		},
		asksToSignIn: {
			gwta: `every visitor to {address: ${DOMAIN_LINK}} is asked to sign in`,
			description: "Check that an address refuses a request that doesn't sign in, as a site behind basic auth does. It fails with what the address answered and what to change.",
			action: async ({ address }: { address: string }) => {
				const why = await whyNotSignedInOnly(address);
				return why ? actionNotOK(why) : OK;
			},
		},
		showPorts: {
			gwta: "show ports",
			productsDomain: DOMAIN_LISTENING_PORTS,
			action: () => actionOKWithProducts({ ports: Object.fromEntries(ServerHono.listeningPorts) }),
		},
		isListening: {
			gwta: `webserver is listening for {why: ${DOMAIN_TEXT}}`,
			action: async ({ why }: { why: string }) => {
				await this.listen(why);
				return OK;
			},
		},
		serveFiles: {
			gwta: `serve files from {loc: ${DOMAIN_FILE_PATH}}`,
			action: ({ loc }: { loc: string }) => {
				try {
					this.webserver?.checkAddStaticFolder(loc, "/", { description: `Files from ${loc}` });
					return OK;
				} catch (e) {
					const message = errorDetail(e);
					return actionNotOK(message);
				}
			},
		},
		serveFilesAt: {
			gwta: `serve files at {where: ${DOMAIN_ROUTE}} from {loc: ${DOMAIN_FILE_PATH}}`,
			action: ({ where, loc }: { where: string; loc: string }) => {
				try {
					this.webserver?.checkAddStaticFolder(loc, where, { description: `Files from ${loc}` });
					return OK;
				} catch (e) {
					const message = errorDetail(e);
					return actionNotOK(message);
				}
			},
		},
		indexFiles: {
			gwta: `index files from {loc: ${DOMAIN_FILE_PATH}}`,
			action: ({ loc }: { loc: string }) => {
				try {
					this.webserver?.checkAddIndexFolder(loc, "/", { description: `An index of the files in ${loc}` });
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
				// Actuality's own registry, which holds what actuality's transports injected, so a caller reaching actuality by RPC
				// dispatches and discovers the same steps as every other caller of actuality.
				this.stepRegistry = runRegistry(this.getWorld());

				const transport = getFromRuntime(this.getWorld().runtime, TRANSPORT) as ITransport;
				// What the registry answers is which methods are reads, which the transport asks before narrating that it
				// served a call: reading a run is not an act of the run, so serving a read is not announced as one.
				(transport as Partial<IStepTransport>).attach?.(this.stepRegistry, this.getWorld().runtime[WEBSERVER] as IWebServer);
				const logger = this.getWorld().eventLogger;

				transport.onMessage(async (raw: unknown, requestInfo) => {
					// A call states the actuality whose records it reads, and one stating another actuality doesn't parse.
					const parsed = parseRpcRequest(raw, this.getWorld().runtime.actualityId);
					if (!parsed.success) return parsed.refusal;
					const msg = parsed.data;
					const { method, params } = msg;

					// Action bootstrap: client asks for a globally-unique seqPath
					// root before issuing any state-changing RPC. Returns the
					// root; client appends monotonic sub-seqs for each call
					// within the action scope.
					if (method === ACTION_BEGIN) {
						const seqPath = this.allocateSessionSeqPath();
						// seqPath[0] is the hostId; returning it explicitly saves remote
						// callers from having to reach into the seqPath to learn which
						// host they're talking to. `site` is this instance's site
						// principal: the federation handshake reads it to stamp and
						// de-collide merged reads.
						// `serving` reports whether this instance's feature has finished setting up (see the SERVING runtime key), so a
						// caller can wait for the instance rather than for its port.
						const { runtime } = this.getWorld();
						const handshake: THandshake = {
							protocol: RPC_PROTOCOL,
							hostId: itemAt(seqPath, 0),
							site: activeSitePrincipal(this.getWorld()),
							actualityId: runtime.actualityId,
							serving: runtime[SERVING] === true,
						};
						return { seqPath, ...handshake };
					}

					const authority = await grantedCapabilityForRequest(requestInfo, this.getWorld().runtime, this);
					const { granted, principal, refused, restsOn } = authority;
					if (refused) return authorityRefusal(`${method}: ${refused}`);
					// A streamed call is held open only while the authority it was allowed under holds.
					const stream = streamContext.getStore();
					if (stream) endWhenLapsed(this.getWorld().runtime, authority, stream.signal, stream.end);

					// A method of a served family: gated by the action it declares, verified through the path a step's capability
					// is, without an ungated default.
					const served = this.webserver?.rpcMethod(method);
					if (served) {
						if (!mayCall(granted, { capability: served.action })) return { error: refusal(method, served.action, principal) };
						try {
							// Whoever proved themselves at this boundary is who acts inside it, as in a dispatched step.
							return await runActingAs(principal, () => served.handle(params), restsOn);
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
						// A call is refused before its input is read, and alike whether its step exists, so a refusal doesn't tell the caller
						// about the steps it may not call.
						const tool = registry.get(method);
						if (!tool || !mayCall(granted, tool.descriptor)) return { error: refusal(method, tool && lackedAction(granted, tool.descriptor), principal) };
						// External callers (without a feature-step context) get a server-synthesised seqPath, matching MCP.
						const seqPath = msg.seqPath && msg.seqPath.length > 0 ? msg.seqPath : allocateSyntheticSeqPath(world);
						const validatedParams = validateToolInput(seqPath, tool, params, world);
						const featureStep = buildFeatureStepForTransport(tool, validatedParams, seqPath);
						// RPC dispatches are SPA-initiated (constant polling like getClusteredQuads), not feature steps;
						// log them at trace so they don't bury actuality's own steps in the timeline. Still visible at debug.
						featureStep.isSubStep = true;
						// Whoever proved themselves at this boundary is who acts inside it, so what a step records names the
						// reader who asked for it rather than the process that carried it out. What it reads is bounded by the read it
						// holds, in dispatch, and by the level the call asked to read at, which can only be narrower.
						const hr = await runWithRequestContext({ baseIri: requestBaseIri(requestInfo?.headers) }, () =>
							// A request holds only what it presented: the server was started inside a step of actuality, and
							// a caller doesn't hold what that step held.
							runActingAs(
								principal,
								() => runReadingAt(msg.readingAt, () => dispatchStep({ registry, world, steppers: this.steppers, grantedCapability: granted }, featureStep)),
								restsOn,
							),
						);
						if (hr.ok) return hr.products ?? ANSWERED_WITHOUT_PRODUCTS;
						return stepFailed(method, hr.errorMessage);
					} catch (err) {
						const detail = errorDetail(err);
						logger.error(`[RPC] ${method}: ${detail}`);
						return stepFailed(method, detail);
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
	} as const satisfies TStepperSteps;

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
