import { describe, it, expect } from "vitest";
import {
	resolveHostId,
	syntheticSeqPath,
	HAIBUN_HOST_ID_ENV,
	DEFAULT_HOST_ID,
	SYNTHETIC_FEATURE_NUM,
	activeSitePrincipal,
	adoptSitePrincipal,
	hasDefaultSitePrincipal,
	HAIBUN_SITE_KEY_ENV,
} from "./host-id.js";

describe("resolveHostId", () => {
	it("returns default when env var is absent", () => {
		expect(resolveHostId({})).toBe(DEFAULT_HOST_ID);
	});

	it("returns default when env var is empty string", () => {
		expect(resolveHostId({ [HAIBUN_HOST_ID_ENV]: "" })).toBe(DEFAULT_HOST_ID);
	});

	it("parses positive integers", () => {
		expect(resolveHostId({ [HAIBUN_HOST_ID_ENV]: "1" })).toBe(1);
		expect(resolveHostId({ [HAIBUN_HOST_ID_ENV]: "42" })).toBe(42);
	});

	it("accepts 0 explicitly", () => {
		expect(resolveHostId({ [HAIBUN_HOST_ID_ENV]: "0" })).toBe(0);
	});

	it("throws on negative values", () => {
		expect(() => resolveHostId({ [HAIBUN_HOST_ID_ENV]: "-1" })).toThrow();
	});

	it("throws on non-integer values", () => {
		expect(() => resolveHostId({ [HAIBUN_HOST_ID_ENV]: "1.5" })).toThrow();
		expect(() => resolveHostId({ [HAIBUN_HOST_ID_ENV]: "abc" })).toThrow();
	});
});

describe("syntheticSeqPath", () => {
	it("produces a 3-segment path with SYNTHETIC_FEATURE_NUM in the middle", () => {
		const p = syntheticSeqPath(0, 7);
		expect(p).toEqual([0, SYNTHETIC_FEATURE_NUM, 7]);
	});

	it("preserves hostId in the root slot", () => {
		expect(syntheticSeqPath(42, 1)).toEqual([42, SYNTHETIC_FEATURE_NUM, 1]);
	});

	it("distinguishable from any valid feature seqPath (featureNum >= 1)", () => {
		// Feature seqPaths are [hostId, featureNum >= 1, scenarioNum >= 1, ...].
		// Synthetic's featureNum is -1 (SYNTHETIC_FEATURE_NUM), so they can never collide.
		const synthetic = syntheticSeqPath(0, 1);
		expect(synthetic[1]).toBeLessThan(1);
	});

	it("two hosts with different hostId produce distinct synthetics for same adHocSeq", () => {
		expect(syntheticSeqPath(0, 5)).not.toEqual(syntheticSeqPath(1, 5));
	});
});

describe("activeSitePrincipal / adoptSitePrincipal", () => {
	const worldWith = (keys?: Record<string, unknown>) => ({ runtime: { keys } });

	it("defaults to the env-resolved site principal (did:site:<hostId>, 0 to itself)", () => {
		const world = worldWith();
		expect(activeSitePrincipal(world, {})).toBe("did:site:0");
		expect(hasDefaultSitePrincipal(world, {})).toBe(true);
	});

	it("an operator-set HAIBUN_SITE_KEY is never the default", () => {
		const world = worldWith();
		expect(activeSitePrincipal(world, { [HAIBUN_SITE_KEY_ENV]: "bulky" })).toBe("did:site:bulky");
		expect(hasDefaultSitePrincipal(world, { [HAIBUN_SITE_KEY_ENV]: "bulky" })).toBe(false);
	});

	it("an adopted principal (peer-assigned at federation) overrides the default for the run", () => {
		const world = worldWith();
		adoptSitePrincipal(world, "did:site:main.1");
		expect(activeSitePrincipal(world, {})).toBe("did:site:main.1");
		expect(hasDefaultSitePrincipal(world, {})).toBe(false);
	});

	it("refuses to adopt a non-DID", () => {
		expect(() => adoptSitePrincipal(worldWith(), "main.1")).toThrow(/expected a DID/);
	});
});
