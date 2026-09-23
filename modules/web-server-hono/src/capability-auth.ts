import type { TRuntime } from "@haibun/core/lib/world.js";
import { getAuthority } from "@haibun/core/lib/session-authority.js";

export type TRequestHeaders = Record<string, string | undefined>;

/** What a request says about itself: a signed presentation covers the method and the address as well as the headers. */
export type TAuthorizedRequest = { method?: string; url?: string; headers?: TRequestHeaders; body?: string };

/** The header a caller presenting proven authority carries, rather than a secret to be looked up. */
const PRESENTED_AUTHORITY_HEADER = "capability-invocation";

/** What a request carries: what its caller may do, and who they proved themselves to be where a proof said so. A
 *  presented proof that fails, or that nothing here can check, is `refused`, and a refused request runs nothing. */
export type TRequestAuthority = { granted?: string[]; principal?: string; refused?: string };

/**
 * What the caller of this request may do: nothing, unless it presents proof of authority it holds, which whatever is
 * registered to read that proof decides. A request presenting proof is asked about as a whole, since a signed request's
 * proof covers what it asks and of what.
 *
 * A proof also says who made it, and that is answered here as well: what is done under a proof is done by whoever
 * proved it, so a record of the doing can name them rather than the process that carried it out.
 */
export async function grantedCapabilityForRequest(request: TAuthorizedRequest | undefined, runtime: TRuntime): Promise<TRequestAuthority> {
	if (!presentsAuthority(request?.headers)) return {};
	const authority = getAuthority(runtime);
	if (!authority?.hasVerifier()) return { refused: "the request presents authority, and nothing here verifies it" };
	if (!request?.method || !request.url) return { refused: "the request presents authority without the method and address its proof covers" };
	const verdict = await authority.verifyEvidence({ kind: "request", method: request.method, url: request.url, headers: request.headers ?? {}, body: request.body });
	if (!verdict.ok) return { refused: `the presented authority failed verification: ${verdict.error ?? "no reason given"}` };
	return { granted: verdict.allowedAction?.length ? verdict.allowedAction : undefined, principal: verdict.principal };
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
