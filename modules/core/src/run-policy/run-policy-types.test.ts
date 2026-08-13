import { describe, it, expect } from "vitest";
import {
	parseDirFilters,
	parseRunPolicyArgs,
	parseRunPolicyEnv,
	accessLevelIncludes,
	getFeatureAccessPrefix,
	featureMatchesFilter,
	OPTION_RUN_POLICY,
	HAIBUN_RUN_POLICY,
} from "./run-policy-types.js";

describe("parseDirFilters", () => {
	it("parses single pair", () => {
		expect(parseDirFilters("smoke:r")).toEqual([{ dir: "smoke", access: "r" }]);
	});
	it("parses multiple pairs", () => {
		expect(parseDirFilters("smoke:r,api:a,web:w")).toEqual([
			{ dir: "smoke", access: "r" },
			{ dir: "api", access: "a" },
			{ dir: "web", access: "w" },
		]);
	});
	it("throws on missing access", () => {
		expect(() => parseDirFilters("smoke")).toThrow();
	});
	it("parses invalid access level (deferred validation)", () => {
		expect(parseDirFilters("smoke:x")).toEqual([{ dir: "smoke", access: "x" }]);
	});
});

describe("parseRunPolicyArgs", () => {
	it("parses valid args", () => {
		const config = parseRunPolicyArgs("prod", "smoke:r,api:a");
		expect(config.place).toBe("prod");
		expect(config.dirFilters).toHaveLength(2);
	});
	it("throws on missing env", () => {
		expect(() => parseRunPolicyArgs("", "smoke:r")).toThrow(/Run policy configuration failed/);
	});
	it("throws on missing dirAccess", () => {
		expect(() => parseRunPolicyArgs("prod", "")).toThrow();
	});
});

describe("parseRunPolicyEnv", () => {
	it("parses valid env string", () => {
		const config = parseRunPolicyEnv("local smoke:r,api:w");
		expect(config.place).toBe("local");
		expect(config.dirFilters).toHaveLength(2);
	});
	it("throws on wrong number of parts", () => {
		expect(() => parseRunPolicyEnv("local")).toThrow(/Invalid format/);
	});
});

describe("accessLevelIncludes", () => {
	// read ⊂ act ⊂ write: a level includes itself and everything below it, and nothing above.
	it.each([
		["r", "r", true],
		["a", "r", true],
		["a", "a", true],
		["w", "r", true],
		["w", "a", true],
		["w", "w", true],
		["r", "a", false],
		["r", "w", false],
		["a", "w", false],
	])("%s includes %s: %s", (held, needed, expected) => {
		expect(accessLevelIncludes(held, needed)).toBe(expected);
	});
});

describe("getFeatureAccessPrefix", () => {
	it.each([
		["r_health.feature", "r"],
		["a_auth.feature", "a"],
		["w_write.feature", "w"],
		["r_test.feature.ts", "r"],
		["health.feature", undefined],
		["x_bad.feature", undefined],
		["test.feature.ts", undefined],
	])("%s reads as %s", (filename, expected) => {
		expect(getFeatureAccessPrefix(filename)).toBe(expected);
	});
});

describe("featureMatchesFilter", () => {
	const filters = [
		{ dir: "smoke", access: "r" as const },
		{ dir: "api", access: "a" as const },
	];

	// A file runs when its directory is listed AND the prefix it declares is within the access that directory grants.
	// Anything else is skipped: an unprefixed file declares nothing, and an unlisted directory grants nothing.
	it.each([
		["/smoke/r_health.feature", true],
		["/api/r_list.feature", true],
		["/api/a_profile.feature", true],
		["/smoke/a_auth.feature", false],
		["/api/w_create.feature", false],
		["/smoke/health.feature", false],
		["/web/r_page.feature", false],
		["/r_orphan.feature", false],
	])("%s runs: %s", (path, expected) => {
		expect(featureMatchesFilter(path, filters)).toBe(expected);
	});

	it("allows wildcard dir filter for any directory", () => {
		const wildcardFilters = [{ dir: "*", access: "r" as const }];
		expect(featureMatchesFilter("/api/r_health.feature", wildcardFilters)).toBe(true);
	});

	it("applies access checks for wildcard dir filter", () => {
		const wildcardFilters = [{ dir: "*", access: "r" as const }];
		expect(featureMatchesFilter("/api/a_auth.feature", wildcardFilters)).toBe(false);
	});

	it("prefers explicit directory rule over wildcard", () => {
		const mixedFilters = [
			{ dir: "*", access: "r" as const },
			{ dir: "api", access: "a" as const },
		];
		expect(featureMatchesFilter("/api/a_auth.feature", mixedFilters)).toBe(true);
	});
});
