import { describe, it, expect } from "vitest";
import { validateRunPolicyConfig } from "./run-policy-schema.js";
import type { TRunPolicyConfig } from "./run-policy-types.js";
import type { TRunPolicy } from "./run-policy-schema.js";

import { ACCESS_LEVELS } from "./run-policy-types.js";

/** Helper: build a policy in hierarchical JSON Schema format */
function makePolicy(
	envs: string[],
	dirs: string[],
	deny: Array<{ place?: string; dir?: string; access?: string }> = [],
): TRunPolicy {
	return {
		type: "object",
		properties: {
			place: { type: "string", enum: envs },
			dirFilters: {
				type: "array",
				items: {
					type: "object",
					properties: {
						dir: { type: "string", enum: dirs },
						access: { type: "string", enum: [...ACCESS_LEVELS] },
					},
					required: ["dir", "access"],
				},
			},
		},
		deny: deny as TRunPolicy["deny"],
	};
}

function makeAppParamsPolicy(): TRunPolicy {
	return {
		type: "object",
		deny: [],
		allOf: [
			{
				if: { properties: { place: { const: "prod" } } },
				then: {
					properties: {
						database_url: { type: "string", format: "uri" },
						retries: { type: "number", minimum: 5 },
					},
					required: ["database_url"],
				},
			},
			{
				if: { properties: { place: { const: "local" } } },
				then: {
					properties: {
						database_url: { const: "localhost:5432" },
					},
				},
			},
		],
	};
}

function makeInheritingAppParamsPolicy(): TRunPolicy {
	return {
		type: "object",
		deny: [],
		definitions: {
			dbSchema: {
				properties: {
					database_url: { type: "string", format: "uri" },
				},
				required: ["database_url"],
			},
			prodSchema: {
				allOf: [
					{ $ref: "#/definitions/dbSchema" },
					{
						properties: {
							retries: { type: "number", minimum: 5 },
						},
					},
				],
			},
		},
		allOf: [
			{
				if: { properties: { place: { const: "prod" } } },
				then: { $ref: "#/definitions/prodSchema" },
			},
			{
				if: { properties: { place: { const: "local" } } },
				then: {
					properties: {
						database_url: { const: "localhost:5432" },
					},
				},
			},
		],
	};
}

function makeMinimalPolicy(): TRunPolicy {
	return {
		type: "object",
		deny: [],
	};
}

const SCHEMA_PATH = "test.json";

describe("validateRunPolicyConfig", () => {
	const basePolicy = makePolicy(
		["local", "dev", "test", "prod"],
		["smoke", "api", "web"],
		[
			{ place: "prod", access: "w" },
			{ place: "prod", dir: "api", access: "a" },
		],
	);

	const policy = { ...basePolicy, allOf: makeAppParamsPolicy().allOf };

	it("accepts valid config", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "smoke", access: "r" }],
			database_url: "localhost:5432",
		};
		expect(validateRunPolicyConfig(config, policy, SCHEMA_PATH)).toEqual([]);
	});

	it("rejects unknown environment via enum", () => {
		const config: TRunPolicyConfig = {
			place: "staging",
			dirFilters: [{ dir: "smoke", access: "r" }],
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
	});

	it("rejects unknown directory via enum", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "regression", access: "r" }],
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
	});

	it("accepts wildcard directory filter", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "*", access: "r" }],
			database_url: "localhost:5432",
		};
		expect(validateRunPolicyConfig(config, policy, SCHEMA_PATH)).toEqual([]);
	});

	it("catches deny rule: w in prod", () => {
		const config: TRunPolicyConfig = {
			place: "prod",
			dirFilters: [{ dir: "smoke", access: "w" }],
			database_url: "http://production.com",
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.includes("Denied"))).toBe(true);
	});

	it("catches deny rule: a in prod api", () => {
		const config: TRunPolicyConfig = {
			place: "prod",
			dirFilters: [{ dir: "api", access: "a" }],
			database_url: "http://production.com",
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.some((e) => e.includes("Denied"))).toBe(true);
	});

	it("allows r in prod (no deny rule for it)", () => {
		const config: TRunPolicyConfig = {
			place: "prod",
			dirFilters: [{ dir: "smoke", access: "r" }],
			database_url: "http://localhost:5432",
		};
		expect(validateRunPolicyConfig(config, policy, SCHEMA_PATH)).toEqual([]);
	});

	it("rejects prod if missing required database_url", () => {
		const config: TRunPolicyConfig = {
			place: "prod",
			dirFilters: [{ dir: "smoke", access: "r" }],
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.includes("must have required property 'database_url'"))).toBe(true);
	});

	it("rejects local if database_url is not constant localhost:5432", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "smoke", access: "r" }],
			database_url: "http://production.com:5432",
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.includes("must be equal to constant"))).toBe(true);
	});

	it("accepts local with correct database_url", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "smoke", access: "r" }],
			database_url: "localhost:5432",
		};
		expect(validateRunPolicyConfig(config, policy, SCHEMA_PATH)).toEqual([]);
	});

	it("rejects config containing undefined app parameters", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "smoke", access: "r" }],
			database_url: "localhost:5432",
			nonsense_parameter: "foo",
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.includes("Unrecognized key(s) in object: 'nonsense_parameter'"))).toBe(true);
	});

	it("rejects an otherwise valid parameter (like retries) when used in the wrong place (like local)", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "smoke", access: "r" }],
			database_url: "localhost:5432",
			retries: 5,
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.includes("Unrecognized key(s) in object: 'retries'"))).toBe(true);
	});
});

describe("validateRunPolicyConfig with $ref and allOf inheritance", () => {
	const basePolicy = makePolicy(["local", "dev", "test", "prod"], ["smoke", "api", "web"], []);

	const appParams = makeInheritingAppParamsPolicy();
	const policy = { ...basePolicy, allOf: appParams.allOf, definitions: appParams.definitions };

	it("accepts prod with database_url inherited from base definition", () => {
		const config: TRunPolicyConfig = {
			place: "prod",
			dirFilters: [{ dir: "smoke", access: "r" }],
			database_url: "http://production.com:5432",
		};
		expect(validateRunPolicyConfig(config, policy, SCHEMA_PATH)).toEqual([]);
	});

	it("rejects prod if missing required database_url inherited from base definition schema", () => {
		const config: TRunPolicyConfig = {
			place: "prod",
			dirFilters: [{ dir: "smoke", access: "r" }],
			retries: 5,
		};
		const errors = validateRunPolicyConfig(config, policy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.includes("must have required property 'database_url'"))).toBe(true);
	});
});

describe("validateRunPolicyConfig with minimal policy", () => {
	const policy = makeMinimalPolicy();

	it("accepts base config even without root properties", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "smoke", access: "r" }],
		};
		expect(validateRunPolicyConfig(config, policy, SCHEMA_PATH)).toEqual([]);
	});
});

describe("validateRunPolicyConfig with anyOf/oneOf", () => {
	const basePolicy = makePolicy(["local", "dev", "test", "prod"], ["smoke", "api", "web"], []);

	const anyOfPolicy: TRunPolicy = {
		...basePolicy,
		anyOf: [
			{
				properties: {
					place: { const: "prod" },
					retries: { type: "number" },
				},
				required: ["place", "retries"],
			},
			{
				properties: {
					place: { const: "local" },
					database_url: { const: "localhost:5432" },
				},
				required: ["place", "database_url"],
			},
		],
	};

	it("accepts config matching an anyOf branch", () => {
		const config: TRunPolicyConfig = {
			place: "local",
			dirFilters: [{ dir: "smoke", access: "r" }],
			database_url: "localhost:5432",
		};
		expect(validateRunPolicyConfig(config, anyOfPolicy, SCHEMA_PATH)).toEqual([]);
	});

	it("rejects config matching no anyOf branches", () => {
		const config: TRunPolicyConfig = {
			place: "dev",
			dirFilters: [{ dir: "smoke", access: "r" }],
		};
		const errors = validateRunPolicyConfig(config, anyOfPolicy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.includes("anyOf"))).toBe(true);
	});

	const oneOfPolicy: TRunPolicy = {
		...basePolicy,
		oneOf: [
			{
				properties: {
					place: { const: "prod" },
					retries: { type: "number" },
				},
				required: ["place", "retries"],
			},
			{
				properties: {
					place: { const: "prod" },
					database_url: { type: "string" },
				},
				required: ["place", "database_url"],
			},
		],
	};

	it("accepts config matching exactly one oneOf branch", () => {
		const config: TRunPolicyConfig = {
			place: "prod",
			dirFilters: [{ dir: "smoke", access: "r" }],
			retries: 5,
		};
		expect(validateRunPolicyConfig(config, oneOfPolicy, SCHEMA_PATH)).toEqual([]);
	});

	it("rejects config matching multiple oneOf branches", () => {
		const config: TRunPolicyConfig = {
			place: "prod",
			dirFilters: [{ dir: "smoke", access: "r" }],
			retries: 5,
			database_url: "http://production.com",
		};
		const errors = validateRunPolicyConfig(config, oneOfPolicy, SCHEMA_PATH);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.includes("oneOf"))).toBe(true);
	});
});
