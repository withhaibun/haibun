/**
 * The `/rpc` calls a server's transport carries to actuality's steps, each under the authority its request presents.
 * Actuality's own registry holds what actuality's transports injected, so a caller reaching actuality by RPC dispatches
 * and discovers the same steps as every other caller of actuality.
 */
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStepper } from "@haibun/core/lib/astepper.js";
import {
	ACTION_BEGIN,
	ANSWERED_WITHOUT_PRODUCTS,
	parseRpcRequest,
	authorityRefusal,
	callFailed,
	refusalCarried,
	RPC_PROTOCOL,
	type THandshake,
} from "@haibun/core/lib/rpc-wire.js";
import { runWithRequestContext, requestBaseIri } from "@haibun/core/lib/request-context.js";
import { refusal } from "@haibun/core/lib/steps/pipelines/gate.js";
import { runRegistry, type StepRegistry } from "@haibun/core/lib/step-registry.js";
import { mayCall } from "@haibun/core/lib/domains/actions.js";
import { activeSitePrincipal } from "@haibun/core/lib/domains/host-id.js";
import { SERVING } from "@haibun/core/lib/domains/serving.js";
import { streamContext } from "@haibun/core/lib/step-stream-context.js";
import { runInvoking, runReadingAsHeld, runReadingAt, runActingAs } from "@haibun/core/lib/domains/capability-context.js";
import type { IWebServer, TCapabilityVerifier } from "../ports.js";
import type { IStepTransport, ITransport } from "../domains/transport.js";
import { notARead } from "../domains/web-server.js";
import { calledStep, dispatchCall, type TCaller } from "./dispatch-call.js";

/** What serving `/rpc` reads: actuality's world and steppers, the server and its transport, the verifier of each request's
 *  authority, and the seqPath root of each session's action. */
export type TServeRpcParts = {
	world: TWorld;
	steppers: AStepper[];
	webserver: IWebServer;
	transport: ITransport & Partial<IStepTransport>;
	verifier: TCapabilityVerifier;
	sessionSeqPath: () => number[];
};

/**
 * Serves `/rpc` calls to actuality's steps on a server's transport, and returns the registry that dispatches the calls.
 * The registry states which methods are reads, which the transport reads before narrating that it served a call: reading
 * actuality isn't an act of actuality, so serving a read isn't announced as one.
 */
export function serveRpc({ world, steppers, webserver, transport, verifier, sessionSeqPath }: TServeRpcParts): StepRegistry {
	const registry = runRegistry(world);
	transport.attach?.(registry);
	const within = { registry, world, steppers };
	transport.onMessage(async (raw, request) => {
		// A call states the actuality whose records it reads, and one stating another actuality doesn't parse.
		const parsed = parseRpcRequest(raw, world.runtime.actualityId);
		if (!parsed.success) return parsed.refusal;
		const msg = parsed.data;
		const { method, params } = msg;
		// A client begins an action by requesting a globally unique seqPath root before its first call that changes state,
		// and appends a count of its own to it for each call within the action.
		if (method === ACTION_BEGIN) {
			const seqPath = sessionSeqPath();
			return { seqPath, ...handshakeOf(world, itemAt(seqPath, 0)) };
		}

		const authority = await verifier.authorityOf(request);
		const { granted, held, principal, refused, restsOn } = authority;
		if (refused) return authorityRefusal(`${method}: ${refused}`);
		// A streamed call is held open only while the authority it was allowed under holds.
		const stream = streamContext.getStore();
		if (stream) verifier.endWhenLapsed(authority, stream.signal, stream.end);
		const caller: TCaller = { granted, held, principal, restsOn, delegate: verifier.delegateOf(authority) };

		// A method of a served family is gated by the action it declares, verified as a step's capability is, without an
		// ungated default.
		const served = webserver.rpcMethod(method);
		if (served) {
			if (!mayCall(granted, { capability: served.action })) return refusal(method, served.action, caller.delegate);
			if (msg.asks === "read") return { error: notARead(method) };
			try {
				// Whoever proved themselves at this boundary acts inside it, holding what it presented and reading within the
				// read it holds, or the narrower level it requested, as in a dispatched step. A caller that doesn't
				// hold a read action is refused each read and write of records.
				return await runInvoking({ invoked: granted, held }, () =>
					runActingAs(principal, () => runReadingAsHeld(held, () => runReadingAt(msg.readingAt, () => served.handle(params))), restsOn),
				);
			} catch (err) {
				return callFailed(method, `the served method failed: ${errorDetail(err)}`, refusalCarried(err)?.remedy);
			}
		}

		try {
			const called = calledStep(within, { method, params, asks: msg.asks, seqPath: msg.seqPath }, caller);
			if ("refused" in called) return called.refused;
			const { featureStep } = called;
			// An RPC dispatch comes from a page, such as its polling of getClusteredQuads, not from a feature: it is logged at
			// trace so it doesn't bury actuality's own steps in the timeline, and it is still visible at debug.
			featureStep.isSubStep = true;
			// What a step reads is bounded by the read its caller holds, in dispatch, and by the level the call requested,
			// which can only be narrower.
			const baseIri = requestBaseIri(request?.headers);
			const hr = await runWithRequestContext({ baseIri }, () => runReadingAt(msg.readingAt, () => dispatchCall(within, caller, called)));
			if (!hr.ok) return callFailed(method, hr.errorMessage, hr.remedy);
			return hr.products === undefined ? ANSWERED_WITHOUT_PRODUCTS : hr.products;
		} catch (err) {
			const detail = errorDetail(err);
			world.eventLogger.error(`[RPC] ${method}: ${detail}`);
			return callFailed(method, `the call's step didn't run: ${detail}`);
		}
	});
	return registry;
}

/**
 * The handshake a session's first call receives. `hostId` is the first part of every seqPath this host allocates, stated
 * so a remote caller doesn't read it from a seqPath. `site` is this instance's site principal, which federation reads to
 * stamp and separate merged reads. `serving` states whether this instance's feature has finished its setup (the SERVING
 * runtime key), so a caller waits for the instance rather than for its port.
 */
function handshakeOf(world: TWorld, hostId: number): THandshake {
	const { runtime } = world;
	return { protocol: RPC_PROTOCOL, hostId, site: activeSitePrincipal(world), actualityId: runtime.actualityId, serving: runtime[SERVING] === true };
}
