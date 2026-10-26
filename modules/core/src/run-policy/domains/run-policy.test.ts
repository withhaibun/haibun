import { describe, it, expect } from "vitest";
import { parseDirFilters, parseRunPolicyArgs, parseRunPolicyOption, accessLevelIncludes, getFeatureAccessPrefix, featureMatchesFilter } from "./run-policy.js";

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
	it("keeps an unknown access level for run-policy-schema to validate", () => {
		expect(parseDirFilters("smoke:x")).toEqual([{ dir: "smoke", access: "x" }]);
	});
});

describe("parseRunPolicyArgs", () => {
	it("parses valid args", () => {
		const config = parseRunPolicyArgs("prod", "smoke:r,api:a");
		expect(config.place).toBe("prod");
		expect(config.dirFilters).toHaveLength(2);
	});
	it("throws on an empty place", () => {
		expect(() => parseRunPolicyArgs("", "smoke:r")).toThrow(/Run policy parsing failed/);
	});
	it("throws on an empty dir filter string", () => {
		expect(() => parseRunPolicyArgs("prod", "")).toThrow();
	});
});

describe("parseRunPolicyOption", () => {
	it("parses valid env string", () => {
		const config = parseRunPolicyOption("local smoke:r,api:w");
		expect(config.place).toBe("local");
		expect(config.dirFilters).toHaveLength(2);
	});
	it("throws on wrong number of parts", () => {
		expect(() => parseRunPolicyOption("local")).toThrow(/RUN_POLICY doesn't have the form/);
	});
});

describe("accessLevelIncludes", () => {
	// read ⊂ act ⊂ write: a level includes itself and each lower level. It doesn't include a higher level.
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
	])("%s has access prefix %s", (filename, expected) => {
		expect(getFeatureAccessPrefix(filename)).toBe(expected);
	});
});

describe("featureMatchesFilter", () => {
	const filters = [
		{ dir: "smoke", access: "r" as const },
		{ dir: "api", access: "a" as const },
	];

	// A file runs when the filters list its directory with its prefix's access level or a higher one.
	// A file without a prefix doesn't run. A file outside a listed directory doesn't run. A file whose prefix needs more access than its directory grants doesn't run.
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

	it("applies the directory filter before the wildcard dir filter", () => {
		const mixedFilters = [
			{ dir: "*", access: "r" as const },
			{ dir: "api", access: "a" as const },
		];
		expect(featureMatchesFilter("/api/a_auth.feature", mixedFilters)).toBe(true);
	});
});
