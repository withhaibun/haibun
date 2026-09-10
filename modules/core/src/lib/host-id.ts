/**
 * hostId: a stable non-negative integer identifying the haibun instance
 * within a deployment. Prepended to every seqPath root so observations from
 * different hosts cannot collide even when running identical features.
 *
 * Single-host deployments keep hostId = 0 (the default) and see no change.
 * Multi-host deployments set HAIBUN_HOST_ID per instance; assigning ids is
 * an operator concern (config, supervisor, orchestration).
 *
 * Aligns with OpenTelemetry's `service.instance.id` convention: a haibun
 * instance is a service instance.
 */
export const HAIBUN_HOST_ID_ENV = "HAIBUN_HOST_ID";
export const DEFAULT_HOST_ID = 0;

/** Reserved featureNum value used for non-feature synthetic seqPaths (ad-hoc RPC, MCP, subprocess). */
export const SYNTHETIC_FEATURE_NUM = -1;

/**
 * Resolve hostId from environment. Returns DEFAULT_HOST_ID when the env var
 * is absent. Throws on non-integer or negative values: a misconfigured
 * hostId would silently break global uniqueness, so fail fast at startup.
 */
export function resolveHostId(env: Record<string, string | undefined> = process.env): number {
	const raw = env[HAIBUN_HOST_ID_ENV];
	if (raw === undefined || raw === "") return DEFAULT_HOST_ID;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0) {
		throw new Error(`${HAIBUN_HOST_ID_ENV} must be a non-negative integer, got "${raw}"`);
	}
	return n;
}

export const HAIBUN_SITE_KEY_ENV = "HAIBUN_SITE_KEY";
export const SITE_DID_PREFIX = "did:site:";

/** The default identity this instance acts as. Defaults to `did:site:<hostId>`; HAIBUN_SITE_KEY overrides (bare → `did:site:<key>`, already-`did:` → used as-is). */
export function resolveSitePrincipal(env: Record<string, string | undefined> = process.env): string {
	const raw = env[HAIBUN_SITE_KEY_ENV];
	if (raw && raw.startsWith("did:")) return raw;
	if (raw) return `${SITE_DID_PREFIX}${raw}`;
	return `${SITE_DID_PREFIX}${resolveHostId(env)}`;
}

/** Runtime key holding an ADOPTED site principal, assigned by a peer at federation time (see adoptSitePrincipal). */
const ADOPTED_SITE_PRINCIPAL = "sitePrincipal";

type TSitePrincipalWorld = { runtime: { keys?: Record<string, unknown> } };

/**
 * This instance's site principal (its identity DID) as seen by a federation: an adopted one when a peer has
 * named it, else the env-resolved default. Distinct from the acting principal (principal.ts), `as subkey`
 * changes who is ACTING; the site a store fact is served by never changes mid-run.
 */
export function activeSitePrincipal(world: TSitePrincipalWorld, env: Record<string, string | undefined> = process.env): string {
	const adopted = world.runtime.keys?.[ADOPTED_SITE_PRINCIPAL];
	return typeof adopted === "string" && adopted.length > 0 ? adopted : resolveSitePrincipal(env);
}

/** True when this instance still carries the default derived principal (`did:site:<hostId>`, nothing adopted or operator-set). */
export function hasDefaultSitePrincipal(world: TSitePrincipalWorld, env: Record<string, string | undefined> = process.env): boolean {
	return activeSitePrincipal(world, env) === `${SITE_DID_PREFIX}${resolveHostId(env)}` && !env[HAIBUN_SITE_KEY_ENV];
}

/**
 * Adopt a peer-assigned site principal: site principals must be unique within a federation, and the default
 * `did:site:0` is valid only in isolation: a default-identified instance asks the site it connects to what
 * it should be called, and adopts the answer for this run. An operator-set principal is never overwritten.
 */
export function adoptSitePrincipal(world: TSitePrincipalWorld, principal: string): void {
	if (!principal.startsWith("did:")) throw new Error(`adoptSitePrincipal: expected a DID, got "${principal}"`);
	(world.runtime.keys ??= {})[ADOPTED_SITE_PRINCIPAL] = principal;
}

/**
 * Synthetic seqPath for calls not tied to a feature step, ad-hoc RPC,
 * MCP tool invocations, subprocess transport. Uses SYNTHETIC_FEATURE_NUM
 * (-1) in the featureNum slot so these paths sort distinctly from any
 * feature path and cannot collide with a running feature.
 */
export function syntheticSeqPath(hostId: number, adHocSeq: number): number[] {
	return [hostId, SYNTHETIC_FEATURE_NUM, adHocSeq];
}

/**
 * Allocate the next synthetic seqPath for the given world. Bumps the
 * world's `adHocSeq` counter and returns a path rooted on the world's
 * hostId. Used by every external-protocol entry point (RPC, MCP,
 * subprocess) so the bump-then-build invariant lives in one place.
 */
export function allocateSyntheticSeqPath(world: { tag: { hostId: number }; runtime: { adHocSeq?: number } }): number[] {
	world.runtime.adHocSeq = (world.runtime.adHocSeq ?? 0) + 1;
	return syntheticSeqPath(world.tag.hostId, world.runtime.adHocSeq);
}
