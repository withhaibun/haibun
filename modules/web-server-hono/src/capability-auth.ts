import type { TRuntime } from "@haibun/core/lib/world.js";
import { getAuthority } from "@haibun/core/lib/session-authority.js";

export type TCapabilityAuthConfig = {
	accessToken?: string;
	accessCapability?: string;
};

export type TRequestHeaders = Record<string, string | undefined>;

/** What a request says about itself: a signed presentation covers the method and the address as well as the headers. */
export type TAuthorizedRequest = { method?: string; url?: string; headers?: TRequestHeaders; body?: string };

/** The header a caller presenting proven authority carries, rather than a secret to be looked up. */
const PRESENTED_AUTHORITY_HEADER = "capability-invocation";

export function validateCapabilityAuthConfig(scope: string, { accessToken, accessCapability }: TCapabilityAuthConfig): void {
	if (!accessCapability || accessToken) return;
	throw new Error(`${scope}: ACCESS_CAPABILITY requires ACCESS_TOKEN`);
}

/**
 * What the caller of this request may do. A caller presents either a token this process issued to itself, which the
 * authority resolves, or proof of authority it holds, which whatever is registered to read that proof decides. A
 * request presenting proof is asked about as a whole, since a signed request's proof covers what it asks and of what.
 */
export async function grantedCapabilityForRequest(request: TAuthorizedRequest | undefined, runtime: TRuntime, config: TCapabilityAuthConfig): Promise<string[] | undefined> {
	const authority = getAuthority(runtime);
	const presented = getHeader(request?.headers, PRESENTED_AUTHORITY_HEADER);
	if (presented && authority?.hasVerifier() && request?.method && request.url) {
		const verdict = await authority.verifyEvidence({ kind: "request", method: request.method, url: request.url, headers: request.headers ?? {}, body: request.body });
		if (!verdict.ok) return undefined;
		return verdict.allowedAction?.length ? verdict.allowedAction : undefined;
	}
	return getGrantedCapabilityFromHeaders(request?.headers, runtime, config);
}

/** What a token this process issued grants: the actions the authority resolves it to, plus a configured access token's own. */
export function getGrantedCapabilityFromHeaders(headers: TRequestHeaders | undefined, runtime: TRuntime, { accessToken, accessCapability }: TCapabilityAuthConfig): string[] | undefined {
	const authorization = getHeader(headers, "authorization");
	if (!authorization?.startsWith("Bearer ")) return undefined;
	const token = authorization.slice(7).trim();
	const granted = new Set<string>();
	if (accessToken && accessCapability && token === accessToken) {
		granted.add(accessCapability);
	}
	for (const action of getAuthority(runtime)?.resolveSession(token) ?? []) {
		granted.add(action);
	}
	return granted.size > 0 ? Array.from(granted) : undefined;
}

function getHeader(headers: TRequestHeaders | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === wanted) return value;
	}
	return undefined;
}
