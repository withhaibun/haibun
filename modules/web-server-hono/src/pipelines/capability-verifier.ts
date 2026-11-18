/**
 * The capability verifier of a server's requests. A request that presents proof is verified as a whole through
 * actuality's authority, since a signed request's proof covers its method, its address and its body's digest. Other
 * packages read it as `@haibun/web-server-hono/capability-auth.js`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { authorityRefusal, REFUSED_INVOCATION, type TRpcRefusal } from "@haibun/core/lib/rpc-wire.js";
import { sentByAnotherSite } from "@haibun/core/lib/request-context.js";
import type { TRuntime } from "@haibun/core/lib/world.js";
import { capabilityAllows } from "@haibun/core/lib/domains/actions.js";
import { refusal } from "@haibun/core/lib/steps/pipelines/gate.js";
import { getAuthority, heldAuthority } from "@haibun/core/lib/domains/session-authority.js";
import { DELEGATIONS_READ_ACTION, type TRestsOn } from "@haibun/core/lib/domains/authority-types.js";
import { PRESENTED_AUTHORITY_HEADER } from "../domains/web-server.js";
import type { Context, TAuthorizedRequest, TCapabilityVerifier, TRequestAuthority, TRequestHeaders, TServed } from "../ports.js";

/** The headers a trusted proxy that re-addresses a request states the address its caller actually used with: the address,
 * and its HMAC under the deployment's shared secret, which the deployment and the proxy hold. */
const ORIGINAL_URL_HEADER = "x-original-url";
const ORIGINAL_URL_SIGNATURE_HEADER = "x-original-url-sig";

/**
 * What the caller of a request may do: the actions this deployment allows without a delegation, which form an empty list
 * unless it states otherwise, and the one action its proof invokes, which the verifier registered to read that proof
 * determines. ZCAP-LD authorizes an invocation for the action it names; the chain it presents states what its caller
 * holds, which bounds what the call reads and is shown and doesn't authorize another call.
 *
 * A proof also states who made it: what is done under a proof is done by whoever proved it, so a record of the doing can
 * name them rather than the process that carried it out.
 */

/** The form of an HMAC of the SHA-256 of the attested address, as the proxy writes it in lower or upper hexadecimal. */
const SIGNATURE_FORM = /^[0-9a-f]{64}$/i;

/** The address a request's proof covers. A trusted proxy that re-addresses a request to reach this server attests the
 * address the caller actually used under the deployment's shared secret, so a proof that covers the caller's address
 * verifies against it rather than the address the proxy forwarded. The server checks an attestation only where the
 * deployment shares the secret it was made under: a header that arrives without a configured secret fails the request
 * rather than being ignored, and an attestation that fails to verify fails the request rather than falling back to the
 * forwarded address. Without those headers, the forwarded address stands, and the caller reached this address. */
function addressCoveredByProof(headers: TRequestHeaders, secret: string | undefined, forwarded: string): { url: string } | { error: string } {
	const original = headerOf(headers, ORIGINAL_URL_HEADER);
	const signature = headerOf(headers, ORIGINAL_URL_SIGNATURE_HEADER);
	if (original === undefined && signature === undefined) return { url: forwarded };
	if (secret === undefined) return { error: "the request states an original-URL header, and this server doesn't configure an original-URL secret" };
	if (original === undefined) return { error: "the request states an original-URL signature without the address it signs" };
	if (signature === undefined || !URL.canParse(original)) return { error: "the original-URL attestation doesn't name an address with its signature" };
	if (!SIGNATURE_FORM.test(signature)) return { error: "the original-URL signature isn't the hexadecimal digest of an HMAC" };
	const expected = createHmac("sha256", secret).update(original).digest();
	const given = Buffer.from(signature, "hex");
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { error: "the original-URL attestation didn't verify under the deployment's secret" };
	return { url: original };
}

export async function grantedCapabilityForRequest(request: TAuthorizedRequest | undefined, runtime: TRuntime, served: TServed): Promise<TRequestAuthority> {
	const { allowedWithoutDelegation, origins, originalUrlSecret } = served;
	// What is allowed without a delegation is allowed to a caller. A page of another site sending a request through a
	// reader's browser isn't that caller, and it can't present a proof, so it is allowed only what a step doesn't require.
	const headers = request?.headers;
	if (headers === undefined || headerOf(headers, PRESENTED_AUTHORITY_HEADER) === undefined) {
		const allowed = sentByAnotherSite(headers, origins) ? [] : [...allowedWithoutDelegation];
		return { allowedAction: allowed, held: allowed };
	}
	const authority = getAuthority(runtime);
	if (!authority?.hasVerifier()) return { allowedAction: [], held: [], refused: "the request presents authority, and a verifier isn't registered to check it" };
	if (!request?.method || !request.url) return { allowedAction: [], held: [], refused: "the request presents authority without the method and address its proof covers" };
	// The proof covers the address the caller used, which a re-addressing proxy attests; what the proxy forwarded is
	// what this server routes, not what the proof binds.
	const covered = addressCoveredByProof(headers, originalUrlSecret, request.url);
	if ("error" in covered) return { allowedAction: [], held: [], refused: covered.error };
	const verdict = await authority.verifyEvidence({ kind: "request", method: request.method, url: covered.url, headers, body: request.body });
	if (!verdict.ok) return { allowedAction: [], held: [], refused: `the presented authority failed verification: ${verdict.error}` };
	if (!verdict.invoked) return { allowedAction: [], held: [], refused: "the verified request doesn't name the action it invokes" };
	const chainAllows = verdict.allowedAction === undefined ? [] : verdict.allowedAction;
	return {
		allowedAction: [...allowedWithoutDelegation, verdict.invoked],
		held: [...allowedWithoutDelegation, ...chainAllows],
		principal: verdict.principal,
		restsOn: verdict.restsOn,
	};
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
	if (!capabilityAllows(authority.allowedAction, action)) return c.json(lacking(c.req.path, authority), REFUSED_INVOCATION);
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
export function endWhenLapsed(runtime: TRuntime, restsOn: TRestsOn | undefined, signal: AbortSignal, end: (reason: string) => void): void {
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
		endWhenLapsed: (restsOn, signal, end) => endWhenLapsed(runtime, restsOn, signal, end),
	};
}

/** The value of a header by its name, in any case. */
function headerOf(headers: TRequestHeaders, name: string): string | undefined {
	const wanted = name.toLowerCase();
	return Object.entries(headers).find(([key]) => key.toLowerCase() === wanted)?.[1];
}
