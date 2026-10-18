/**
 * hostId is a stable non-negative integer that identifies a haibun instance within a deployment. It prefixes every
 * seqPath root, so observations from different hosts don't collide when the hosts execute identical features.
 *
 * A single-host deployment keeps the default hostId 0. A multi-host deployment sets HAIBUN_HOST_ID per instance. An
 * operator assigns the ids through config, a supervisor or orchestration.
 *
 * hostId follows OpenTelemetry's `service.instance.id` convention. A haibun instance is a service instance.
 */
export const HAIBUN_HOST_ID_ENV = "HAIBUN_HOST_ID";
export const DEFAULT_HOST_ID = 0;

/** Reserved featureNum value used for non-feature synthetic seqPaths (ad-hoc RPC and MCP). */
export const SYNTHETIC_FEATURE_NUM = -1;

/**
 * Reads hostId from the environment. Returns DEFAULT_HOST_ID when the variable is absent or empty. Throws on a
 * non-integer or negative value, since a misconfigured hostId would make seqPaths collide across hosts without an error.
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

/** Returns this instance's default identity. That identity is `did:site:<hostId>` unless HAIBUN_SITE_KEY is set. A bare key becomes `did:site:<key>`, and a key that starts with `did:` is used as-is. */
export function resolveSitePrincipal(env: Record<string, string | undefined> = process.env): string {
	const raw = env[HAIBUN_SITE_KEY_ENV];
	if (raw && raw.startsWith("did:")) return raw;
	if (raw) return `${SITE_DID_PREFIX}${raw}`;
	return `${SITE_DID_PREFIX}${resolveHostId(env)}`;
}

/** Runtime key for the site principal a peer assigns at federation time (see adoptSitePrincipal). */
const ADOPTED_SITE_PRINCIPAL = "sitePrincipal";

type TSitePrincipalWorld = { runtime: { keys?: Record<string, unknown> } };

/**
 * Returns the DID that identifies this instance in a federation. That DID is the principal a peer assigned, or the
 * env-resolved default when a peer hasn't assigned one. The site principal differs from the acting principal in principal.ts. A statement under a
 * capability changes the acting principal. It doesn't change the site principal that serves a store fact.
 */
export function activeSitePrincipal(world: TSitePrincipalWorld, env: Record<string, string | undefined> = process.env): string {
	const adopted = world.runtime.keys?.[ADOPTED_SITE_PRINCIPAL];
	return typeof adopted === "string" && adopted.length > 0 ? adopted : resolveSitePrincipal(env);
}

/** True when this instance still carries the default derived principal (`did:site:<hostId>`, without an adopted or operator-set principal). */
export function hasDefaultSitePrincipal(world: TSitePrincipalWorld, env: Record<string, string | undefined> = process.env): boolean {
	return activeSitePrincipal(world, env) === `${SITE_DID_PREFIX}${resolveHostId(env)}` && !env[HAIBUN_SITE_KEY_ENV];
}

/**
 * Stores a site principal that a peer assigned. Site principals must be unique within a federation, and the default
 * `did:site:0` is valid only for an isolated instance. `federate graph reads from {where}` requests a name from the peer
 * when this instance's default principal matches the peer's principal. adoptSitePrincipal stores that name in the
 * world's runtime keys. A caller calls adoptSitePrincipal only when hasDefaultSitePrincipal is true, so an operator-set
 * principal isn't overwritten.
 */
export function adoptSitePrincipal(world: TSitePrincipalWorld, principal: string): void {
	if (!principal.startsWith("did:")) throw new Error(`adoptSitePrincipal: expected a DID, got "${principal}"`);
	(world.runtime.keys ??= {})[ADOPTED_SITE_PRINCIPAL] = principal;
}

/**
 * Builds the seqPath for a call that isn't tied to a feature step, such as an ad-hoc RPC or an MCP tool invocation.
 * SYNTHETIC_FEATURE_NUM (-1) in the featureNum slot sorts these paths apart from every feature path, so they don't
 * collide with an executing feature.
 */
export function syntheticSeqPath(hostId: number, adHocSeq: number): number[] {
	return [hostId, SYNTHETIC_FEATURE_NUM, adHocSeq];
}

/**
 * Allocates the next synthetic seqPath for a world. Increments the world's `adHocSeq` counter and returns a path rooted
 * at the world's hostId. Every external-protocol entry point (RPC, MCP) calls it, so one function increments the
 * counter and builds the path.
 */
export function allocateSyntheticSeqPath(world: { tag: { hostId: number }; runtime: { adHocSeq?: number } }): number[] {
	world.runtime.adHocSeq = (world.runtime.adHocSeq ?? 0) + 1;
	return syntheticSeqPath(world.tag.hostId, world.runtime.adHocSeq);
}
