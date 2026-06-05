/**
 * hostId — a stable non-negative integer identifying the haibun instance
 * within a deployment. Prepended to every seqPath root so observations from
 * different hosts cannot collide even when running identical features.
 *
 * Single-host deployments keep hostId = 0 (the default) and see no change.
 * Multi-host deployments set HAIBUN_HOST_ID per instance; assigning ids is
 * an operator concern (config, supervisor, orchestration).
 *
 * Aligns with OpenTelemetry's `service.instance.id` convention — a haibun
 * instance is a service instance.
 */
export const HAIBUN_HOST_ID_ENV = "HAIBUN_HOST_ID";
export const DEFAULT_HOST_ID = 0;

/** Reserved featureNum value used for non-feature synthetic seqPaths (ad-hoc RPC, MCP, subprocess). */
export const SYNTHETIC_FEATURE_NUM = -1;

/**
 * Resolve hostId from environment. Returns DEFAULT_HOST_ID when the env var
 * is absent. Throws on non-integer or negative values — a misconfigured
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
const SITE_DID_PREFIX = "did:site:";

/** The default identity this instance acts as. Defaults to `did:site:<hostId>`; HAIBUN_SITE_KEY overrides (bare → `did:site:<key>`, already-`did:` → used as-is). */
export function resolveSitePrincipal(env: Record<string, string | undefined> = process.env): string {
	const raw = env[HAIBUN_SITE_KEY_ENV];
	if (raw && raw.startsWith("did:")) return raw;
	if (raw) return `${SITE_DID_PREFIX}${raw}`;
	return `${SITE_DID_PREFIX}${resolveHostId(env)}`;
}

/**
 * Synthetic seqPath for calls not tied to a feature step — ad-hoc RPC,
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
