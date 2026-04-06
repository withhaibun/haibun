import type { TRuntime } from "@haibun/core/lib/defs.js";
import { getZcapLikeAuthority } from "@haibun/core/lib/zcap-like-authority.js";

export type TCapabilityAuthConfig = {
	accessToken?: string;
	accessCapability?: string;
};

export type TRequestHeaders = Record<string, string | undefined>;

export function validateCapabilityAuthConfig(scope: string, { accessToken, accessCapability }: TCapabilityAuthConfig): void {
	if (!accessCapability || accessToken) return;
	throw new Error(`${scope}: ACCESS_CAPABILITY requires ACCESS_TOKEN`);
}

export function getGrantedCapabilityFromHeaders(
	headers: TRequestHeaders | undefined,
	runtime: TRuntime,
	{ accessToken, accessCapability }: TCapabilityAuthConfig,
): string[] | undefined {
	const authorization = getHeader(headers, "authorization");
	if (!authorization?.startsWith("Bearer ")) return undefined;
	const token = authorization.slice(7).trim();
	const granted = new Set<string>();
	if (accessToken && accessCapability && token === accessToken) {
		granted.add(accessCapability);
	}
	for (const capability of getZcapLikeAuthority(runtime)?.resolveBearerToken(token) ?? []) {
		granted.add(capability);
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
