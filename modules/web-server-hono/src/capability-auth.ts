import type { Context, MiddlewareHandler } from "hono";
import type { TRuntime } from "@haibun/core/lib/world.js";
import { capabilityAllows } from "@haibun/core/lib/actions.js";
import { refusal } from "@haibun/core/lib/step-registry.js";
import { getAuthority, heldAuthority } from "@haibun/core/lib/session-authority.js";
import type { TRestsOn } from "@haibun/core/lib/authority-types.js";

type TRequestHeaders = Record<string, string | undefined>;

/** What a request says about itself: a signed presentation covers the method and the address as well as the headers. */
type TAuthorizedRequest = { method?: string; url?: string; headers?: TRequestHeaders; body?: string };

/** The header a caller presenting proven authority carries, rather than a secret to be looked up. */
const PRESENTED_AUTHORITY_HEADER = "capability-invocation";

/** The headers a request presenting authority carries: its signature, the capability it invokes, and its body's digest. */
export const PRESENTED_REQUEST_HEADERS = ["authorization", PRESENTED_AUTHORITY_HEADER, "digest"] as const;

/** What a request carries: what its caller may do, who they proved themselves to be where a proof said so, and what that
 *  proof rests on. A presented proof that fails, or that the runtime can't check, is `refused`, and a refused request doesn't run
 *  a step. */
type TRequestAuthority = { granted: string[]; principal?: string; restsOn?: TRestsOn; refused?: string };

/**
 * What the caller of this request may do: the actions this deployment allows without a delegation, which form an empty list
 * unless it says otherwise, and what proof it presents of authority it holds, which whatever is registered to read that proof decides.
 * A request presenting proof is asked about as a whole, since a signed request's proof covers what it asks and of what.
 *
 * A proof also says who made it, and that is answered here as well: what is done under a proof is done by whoever
 * proved it, so a record of the doing can name them rather than the process that carried it out.
 */
export async function grantedCapabilityForRequest(
	request: TAuthorizedRequest | undefined,
	runtime: TRuntime,
	allowedWithoutDelegation: readonly string[],
): Promise<TRequestAuthority> {
	if (!presentsAuthority(request?.headers)) return { granted: [...allowedWithoutDelegation] };
	const authority = getAuthority(runtime);
	if (!authority?.hasVerifier()) return { granted: [], refused: "the request presents authority, and a verifier isn't registered to check it" };
	if (!request?.method || !request.url) return { granted: [], refused: "the request presents authority without the method and address its proof covers" };
	const verdict = await authority.verifyEvidence({ kind: "request", method: request.method, url: request.url, headers: request.headers ?? {}, body: request.body });
	if (!verdict.ok) return { granted: [], refused: `the presented authority failed verification: ${verdict.error}` };
	return { granted: [...allowedWithoutDelegation, ...(verdict.allowedAction ?? [])], principal: verdict.principal, restsOn: verdict.restsOn };
}

/** A request's authority where it allows `action`, or else the answer that refuses it: a presented proof that fails is
 *  refused 401, and authority that doesn't allow the action 403. */
export async function authorityAllowing(c: Context, action: string, runtime: TRuntime, allowedWithoutDelegation: readonly string[]): Promise<TRequestAuthority | Response> {
	const authority = await grantedCapabilityForRequest({ method: c.req.method, url: c.req.url, headers: c.req.header() }, runtime, allowedWithoutDelegation);
	if (authority.refused) return c.json({ error: `${c.req.path}: ${authority.refused}` }, 401);
	if (!capabilityAllows(authority.granted, action)) return c.json({ error: refusal(c.req.path, action, authority.principal) }, 403);
	return authority;
}

/** A route's middleware that answers only a request whose authority allows `action`. */
export const requiring =
	(action: string, runtime: TRuntime, allowedWithoutDelegation: () => readonly string[]): MiddlewareHandler =>
	async (c, next) => {
		const allowing = await authorityAllowing(c, action, runtime, allowedWithoutDelegation());
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
