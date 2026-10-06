import { SIGNATURE_HEADER } from "@haibun/core/lib/signature-header.js";
import { authorityRefusal, REFUSED_INVOCATION } from "@haibun/core/lib/rpc-wire.js";
import { sentByAnotherSite } from "@haibun/core/lib/request-context.js";
import type { Context, MiddlewareHandler } from "hono";
import type { TRuntime } from "@haibun/core/lib/world.js";
import { capabilityAllows } from "@haibun/core/lib/actions.js";
import { refusal } from "@haibun/core/lib/step-registry.js";
import { getAuthority, heldAuthority } from "@haibun/core/lib/session-authority.js";
import { DELEGATIONS_READ_ACTION, type TRestsOn } from "@haibun/core/lib/authority-types.js";
import type { IWebServer } from "./defs.js";

type TRequestHeaders = Record<string, string | undefined>;

/** What a request carries about itself: a signed presentation covers the method and the address as well as the headers. */
type TAuthorizedRequest = { method?: string; url?: string; headers?: TRequestHeaders; body?: string };

/** The header a caller presenting proven authority carries, rather than a secret to be looked up. */
const PRESENTED_AUTHORITY_HEADER = "capability-invocation";

/** The headers a request presenting authority carries: its signature, the capability it invokes, and its body's digest. */
export const PRESENTED_REQUEST_HEADERS = [SIGNATURE_HEADER, PRESENTED_AUTHORITY_HEADER, "digest"] as const;

/** What a request carries: what its caller may do, who they proved themselves to be where a proof stated so, and what that
 *  proof rests on. A presented proof that fails, or that the runtime can't check, is `refused`, and a refused request doesn't run
 *  a step. */
/** What a server states about its callers: what each may do without a delegation. */
type TServed = Pick<IWebServer, "allowedWithoutDelegation">;

/** What a request is authorized for, `granted`, and what its caller holds, `held`, which bounds what it reads and is shown. */
type TRequestAuthority = { granted: string[]; held: string[]; principal?: string; restsOn?: TRestsOn; refused?: string };

/**
 * What the caller of this request may do: the actions this deployment allows without a delegation, which form an empty list
 * unless it states otherwise, and the one action its proof invokes, which whatever is registered to read that proof decides.
 * A request presenting proof is asked about as a whole, since a signed request's proof covers what it asks and of what.
 * ZCAP-LD authorizes an invocation for the action it names; the chain it presents states what its caller holds, which
 * bounds what the call reads and is shown and doesn't authorize another call.
 *
 * A proof also states who made it, and that is answered here as well: what is done under a proof is done by whoever
 * proved it, so a record of the doing can name them rather than the process that carried it out.
 */
export async function grantedCapabilityForRequest(request: TAuthorizedRequest | undefined, runtime: TRuntime, served: TServed): Promise<TRequestAuthority> {
	const { allowedWithoutDelegation } = served;
	// What is allowed without a delegation is allowed to a caller. A page of another site sending a request through a
	// reader's browser isn't that caller, and it can't present a proof, so it is allowed only what a step doesn't require.
	if (!presentsAuthority(request?.headers)) {
		const allowed = sentByAnotherSite(request?.headers) ? [] : [...allowedWithoutDelegation];
		return { granted: allowed, held: allowed };
	}
	const authority = getAuthority(runtime);
	if (!authority?.hasVerifier()) return { granted: [], held: [], refused: "the request presents authority, and a verifier isn't registered to check it" };
	if (!request?.method || !request.url) return { granted: [], held: [], refused: "the request presents authority without the method and address its proof covers" };
	const verdict = await authority.verifyEvidence({ kind: "request", method: request.method, url: request.url, headers: request.headers ?? {}, body: request.body });
	if (!verdict.ok) return { granted: [], held: [], refused: `the presented authority failed verification: ${verdict.error}` };
	if (!verdict.invoked) return { granted: [], held: [], refused: "the verified request doesn't name the action it invokes" };
	return { granted: [...allowedWithoutDelegation, verdict.invoked], held: [...allowedWithoutDelegation, ...(verdict.allowedAction ?? [])], principal: verdict.principal, restsOn: verdict.restsOn };
}

/**
 * Who a refusal names the lacked action to: a caller whose proof holds a delegation, which can ask its delegator for what it
 * lacks. A key holds the read of its own delegations without being delegated anything, so a caller holding only that and
 * what every caller holds is told what a caller that proved nothing is told, and a refusal doesn't map actuality for it.
 */
export function delegateOf({ held, principal }: Pick<TRequestAuthority, "held" | "principal">, served: TServed): string | undefined {
	const everyCaller = new Set<string>([...served.allowedWithoutDelegation, DELEGATIONS_READ_ACTION]);
	return held.some((action) => !everyCaller.has(action)) ? principal : undefined;
}

/** The answer to a request whose presented authority failed verification, naming why and offering to read again what the
 *  key holds. */
export const refuseInvocation = (c: Context, error: string): Response => c.json(authorityRefusal(error), REFUSED_INVOCATION);

/** A request's authority where it allows `action`, or else the answer that refuses it, 403 whether its proof fails or its
 *  authority doesn't allow the action, each naming why. */
export async function authorityAllowing(c: Context, action: string, runtime: TRuntime, served: TServed): Promise<TRequestAuthority | Response> {
	const authority = await grantedCapabilityForRequest({ method: c.req.method, url: c.req.url, headers: c.req.header() }, runtime, served);
	if (authority.refused) return refuseInvocation(c, `${c.req.path}: ${authority.refused}`);
	if (!capabilityAllows(authority.granted, action)) return c.json({ error: refusal(c.req.path, action, delegateOf(authority, served)) }, REFUSED_INVOCATION);
	return authority;
}

/** A route's middleware that answers only a request whose authority allows `action`. */
export const requiring =
	(action: string, runtime: TRuntime, served: TServed): MiddlewareHandler =>
	async (c, next) => {
		const allowing = await authorityAllowing(c, action, runtime, served);
		if (allowing instanceof Response) return allowing;
		await next();
	};

/**
 * Hold a call open only while the authority it was allowed under holds: `end` is told why once a capability its proof
 * rests on is revoked or expires, and watching stops when `signal` aborts. A call allowed without a proof doesn't rest on
 * a capability that lapses.
 */
export function endWhenLapsed(runtime: TRuntime, { restsOn }: TRequestAuthority, signal: AbortSignal, end: (reason: string) => void): void {
	if (!restsOn) return;
	const held = heldAuthority(runtime, "watching the authority a call rests on").holdWhile(restsOn);
	signal.addEventListener("abort", held.release, { once: true });
	if (held.signal.aborted) end(String(held.signal.reason));
	else held.signal.addEventListener("abort", () => end(String(held.signal.reason)), { once: true });
}

/** Whether a request presents proven authority, which its whole request is then verified for. */
function presentsAuthority(headers: TRequestHeaders | undefined): boolean {
	return getHeader(headers, PRESENTED_AUTHORITY_HEADER) !== undefined;
}

function getHeader(headers: TRequestHeaders | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === wanted) return value;
	}
	return undefined;
}
