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

/**
 * Synthetic seqPath for calls not tied to a feature step — ad-hoc RPC,
 * MCP tool invocations, subprocess transport. Uses SYNTHETIC_FEATURE_NUM
 * (-1) in the featureNum slot so these paths sort distinctly from any
 * feature path and cannot collide with a running feature.
 */
export function syntheticSeqPath(hostId: number, adHocSeq: number): number[] {
	return [hostId, SYNTHETIC_FEATURE_NUM, adHocSeq];
}
