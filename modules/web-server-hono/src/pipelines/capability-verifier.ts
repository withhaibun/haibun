/**
 * The capability verifier of a server's requests. A request that presents proof is verified as a whole through
 * actuality's authority, since a signed request's proof covers its method, its address and its body's digest. Other
 * packages read it as `@haibun/web-server-hono/capability-auth.js`.
 */
import type { MiddlewareHandler } from "hono";
import { authorityRefusal, REFUSED_INVOCATION, type TRpcRefusal } from "@haibun/core/lib/rpc-wire.js";
import { sentByAnotherSite } from "@haibun/core/lib/request-context.js";
import type { TRuntime } from "@haibun/core/lib/world.js";
import { capabilityAllows } from "@haibun/core/lib/domains/actions.js";
import { refusal } from "@haibun/core/lib/steps/pipelines/gate.js";
import { getAuthority, heldAuthority } from "@haibun/core/lib/domains/session-authority.js";
import { DELEGATIONS_READ_ACTION } from "@haibun/core/lib/domains/authority-types.js";
import {
	PRESENTED_AUTHORITY_HEADER,
	type Context,
	type TAuthorizedRequest,
	type TCapabilityVerifier,
	type TRequestAuthority,
	type TRequestHeaders,
	type TServed,
} from "../ports.js";

/**
 * What the caller of a request may do: the actions this deployment allows without a delegation, which form an empty list
 * unless it states otherwise, and the one action its proof invokes, which the verifier registered to read that proof
 * determines. ZCAP-LD authorizes an invocation for the action it names; the chain it presents states what its caller
 * holds, which bounds what the call reads and is shown and doesn't authorize another call.
 *
 * A proof also states who made it: what is done under a proof is done by whoever proved it, so a record of the doing can
 * name them rather than the process that carried it out.
 */
export async function grantedCapabilityForRequest(request: TAuthorizedRequest | undefined, runtime: TRuntime, served: TServed): Promise<TRequestAuthority> {
	const { allowedWithoutDelegation } = served;
	// What is allowed without a delegation is allowed to a caller. A page of another site sending a request through a
	// reader's browser isn't that caller, and it can't present a proof, so it is allowed only what a step doesn't require.
	const headers = request?.headers;
	if (headers === undefined || headerOf(headers, PRESENTED_AUTHORITY_HEADER) === undefined) {
		const allowed = sentByAnotherSite(headers) ? [] : [...allowedWithoutDelegation];
		return { granted: allowed, held: allowed };
	}
	const authority = getAuthority(runtime);
	if (!authority?.hasVerifier()) return { granted: [], held: [], refused: "the request presents authority, and a verifier isn't registered to check it" };
	if (!request?.method || !request.url) return { granted: [], held: [], refused: "the request presents authority without the method and address its proof covers" };
	const verdict = await authority.verifyEvidence({ kind: "request", method: request.method, url: request.url, headers, body: request.body });
	if (!verdict.ok) return { granted: [], held: [], refused: `the presented authority failed verification: ${verdict.error}` };
	if (!verdict.invoked) return { granted: [], held: [], refused: "the verified request doesn't name the action it invokes" };
	const chainAllows = verdict.allowedAction === undefined ? [] : verdict.allowedAction;
	return { granted: [...allowedWithoutDelegation, verdict.invoked], held: [...allowedWithoutDelegation, ...chainAllows], principal: verdict.principal, restsOn: verdict.restsOn };
}

/**
 * Who a refusal names the lacked action to: a caller whose proof holds a delegation, which can request what it lacks from
 * its delegator. A key holds the read of its own delegations without being delegated anything, so a caller holding only
 * that and what every caller holds receives the refusal of a caller without a proof, and a refusal doesn't map
 * actuality for it.
 */
export function delegateOf({ held, principal }: Pick<TRequestAuthority, "held" | "principal">, served: TServed): string | undefined {
	const everyCaller = new Set<string>([...served.allowedWithoutDelegation, DELEGATIONS_READ_ACTION]);
	return held.some((action) => !everyCaller.has(action)) ? principal : undefined;
}

/** The response to a request whose presented authority failed verification, naming why, with the remedy that reads again
 *  what the key holds. */
export const refuseInvocation = (c: Context, error: string): Response => c.json(authorityRefusal(error), REFUSED_INVOCATION);

/** The refusal of a request at `path` whose authority doesn't allow the route's action. */
export type TLacking = (path: string, authority: TRequestAuthority) => TRpcRefusal;

/** The refusal of a route that requires `action`, which names the action to a caller whose proof holds a delegation. */
const lackingAction =
	(action: string, served: TServed): TLacking =>
	(path, authority) =>
		refusal(path, action, delegateOf(authority, served));

/** A request's authority where it allows `action`, or else the response that refuses it, 403 whether its proof fails or its
 *  authority doesn't allow the action, each naming why: a failed proof as itself, and a lacked action as `lacking` states it. */
async function authorityElse(c: Context, action: string, runtime: TRuntime, served: TServed, lacking: TLacking): Promise<TRequestAuthority | Response> {
	const authority = await grantedCapabilityForRequest({ method: c.req.method, url: c.req.url, headers: c.req.header() }, runtime, served);
	if (authority.refused) return refuseInvocation(c, `${c.req.path}: ${authority.refused}`);
	if (!capabilityAllows(authority.granted, action)) return c.json(lacking(c.req.path, authority), REFUSED_INVOCATION);
	return authority;
}

/** A request's authority where it allows `action`, or else the response that refuses it, 403 whether its proof fails or its
 *  authority doesn't allow the action, each naming why. */
export const authorityAllowing = (c: Context, action: string, runtime: TRuntime, served: TServed): Promise<TRequestAuthority | Response> =>
	authorityElse(c, action, runtime, served, lackingAction(action, served));

/** A route's middleware that serves only a request whose authority allows `action`, and refuses another as `lacking` states. */
export const requiringElse =
	(action: string, runtime: TRuntime, served: TServed, lacking: TLacking): MiddlewareHandler =>
	async (c, next) => {
		const allowing = await authorityElse(c, action, runtime, served, lacking);
		if (allowing instanceof Response) return allowing;
		await next();
	};

/** A route's middleware that serves only a request whose authority allows `action`. */
export const requiring = (action: string, runtime: TRuntime, served: TServed): MiddlewareHandler => requiringElse(action, runtime, served, lackingAction(action, served));

/**
 * Holds a call open only while the authority it was allowed under holds: `end` receives the reason once a capability its
 * proof rests on is revoked or expires, and watching stops when `signal` aborts. A call allowed without a proof doesn't
 * rest on a capability that lapses.
 */
export function endWhenLapsed(runtime: TRuntime, { restsOn }: TRequestAuthority, signal: AbortSignal, end: (reason: string) => void): void {
	if (!restsOn) return;
	const held = heldAuthority(runtime, "watching the authority a call rests on").holdWhile(restsOn);
	signal.addEventListener("abort", held.release, { once: true });
	if (held.signal.aborted) end(String(held.signal.reason));
	else held.signal.addEventListener("abort", () => end(String(held.signal.reason)), { once: true });
}

/** The capability verifier of a server whose callers `served` states, through actuality's authority in `runtime`. */
export function capabilityVerifier(runtime: TRuntime, served: TServed): TCapabilityVerifier {
	return {
		authorityOf: (request) => grantedCapabilityForRequest(request, runtime, served),
		allowing: (c, action) => authorityAllowing(c, action, runtime, served),
		delegateOf: (authority) => delegateOf(authority, served),
		endWhenLapsed: (authority, signal, end) => endWhenLapsed(runtime, authority, signal, end),
	};
}

/** The value of a header by its name, in any case. */
function headerOf(headers: TRequestHeaders, name: string): string | undefined {
	const wanted = name.toLowerCase();
	return Object.entries(headers).find(([key]) => key.toLowerCase() === wanted)?.[1];
}
