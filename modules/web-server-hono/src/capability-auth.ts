import type { TRuntime } from "@haibun/core/lib/world.js";
import { getAuthority } from "@haibun/core/lib/session-authority.js";
import type { TRestsOn } from "@haibun/core/lib/authority-types.js";

export type TRequestHeaders = Record<string, string | undefined>;

/** What a request says about itself: a signed presentation covers the method and the address as well as the headers. */
export type TAuthorizedRequest = { method?: string; url?: string; headers?: TRequestHeaders; body?: string };

/** The header a caller presenting proven authority carries, rather than a secret to be looked up. */
const PRESENTED_AUTHORITY_HEADER = "capability-invocation";

/** What a request carries: what its caller may do, who they proved themselves to be where a proof said so, and what that
 *  proof rests on. A presented proof that fails, or that nothing here can check, is `refused`, and a refused request runs
 *  nothing. */
export type TRequestAuthority = { granted: string[]; principal?: string; restsOn?: TRestsOn; refused?: string };

/**
 * What the caller of this request may do: the actions this deployment allows without a delegation, which are none
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
	if (!authority?.hasVerifier()) return { granted: [], refused: "the request presents authority, and nothing here verifies it" };
	if (!request?.method || !request.url) return { granted: [], refused: "the request presents authority without the method and address its proof covers" };
	const verdict = await authority.verifyEvidence({ kind: "request", method: request.method, url: request.url, headers: request.headers ?? {}, body: request.body });
	if (!verdict.ok) return { granted: [], refused: `the presented authority failed verification: ${verdict.error ?? "no reason given"}` };
	return { granted: [...allowedWithoutDelegation, ...(verdict.allowedAction ?? [])], principal: verdict.principal, restsOn: verdict.restsOn };
}

/**
 * Hold a call open only while the authority it was allowed under holds: `end` is told why once a capability its proof
 * rests on is revoked or expires, and watching stops when `signal` aborts. A call allowed without a proof rests on
 * nothing that lapses.
 */
export function endWhenLapsed(runtime: TRuntime, { restsOn }: TRequestAuthority, signal: AbortSignal, end: (reason: string) => void): void {
	if (!restsOn) return;
	const authority = getAuthority(runtime);
	if (!authority) throw new Error("a call rests on verified authority, and this process holds no authority to watch it");
	const held = authority.holdWhile(restsOn);
	signal.addEventListener("abort", held.release, { once: true });
	if (held.signal.aborted) end(String(held.signal.reason));
	else held.signal.addEventListener("abort", () => end(String(held.signal.reason)), { once: true });
}

/** Whether a request presents proven authority, which its whole request is then verified for. */
export function presentsAuthority(headers: TRequestHeaders | undefined): boolean {
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
