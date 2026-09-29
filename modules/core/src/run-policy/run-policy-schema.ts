import { z } from "zod";
import { fromJsonText } from "../lib/json-text.js";
import { readFileSync } from "fs";
import { RUN_ACCESS_LEVELS, type TRunPolicyConfig } from "./run-policy-types.js";

// ============================================================================
// Policy File Schema, Hierarchical JSON Schema
// ============================================================================

const DenyRuleSchema = z.object({
	place: z.string().optional(),
	dir: z.string().optional(),
	access: z.enum(RUN_ACCESS_LEVELS).optional(),
});

/**
 * Validates the policy file structure itself.
 * The structure mirrors TRunPolicyConfig (place + dirFilters array).
 */
const PolicyFileSchema = z.looseObject({
	$schema: z.string().optional(),
	type: z.literal("object").default("object"),
	properties: z.looseObject({}).optional(),
	definitions: z.looseObject({}).optional(),
	$defs: z.looseObject({}).optional(),
	required: z.array(z.string()).optional(),
	allOf: z.array(z.unknown()).optional(),
	anyOf: z.array(z.unknown()).optional(),
	oneOf: z.array(z.unknown()).optional(),
	deny: z.array(DenyRuleSchema).default([]),
});

export type TRunPolicy = z.infer<typeof PolicyFileSchema>;

/** Load and parse a policy file */
function loadRunPolicy(schemaPath: string): TRunPolicy {
	let raw: string;
	try {
		raw = readFileSync(schemaPath, "utf-8");
	} catch (err) {
		throw new Error(`Cannot read run policy "${schemaPath}": ${(err as Error).message}`);
	}
	return fromJsonText(PolicyFileSchema).parse(raw);
}

function resolveRef(ref: string, rootDocs: unknown[]): unknown {
	if (!ref.startsWith("#/")) return undefined;
	const parts = ref.substring(2).split("/");
	for (const doc of rootDocs) {
		if (!doc) continue;
		let curr: unknown = doc;
		for (const part of parts) {
			if (typeof curr === "object" && curr !== null && part in curr) {
				curr = Reflect.get(curr, part);
			} else {
				curr = undefined;
				break;
			}
		}
		if (curr !== undefined) return curr;
	}
	return undefined;
}

/** A JSON Schema node as the evaluator reads it: a boolean schema, or an object stating the conditions it checks. */
const SchemaNodeSchema = z.union([
	z.boolean(),
	z.looseObject({
		$ref: z.string().optional(),
		allOf: z.array(z.unknown()).optional(),
		anyOf: z.array(z.unknown()).optional(),
		oneOf: z.array(z.unknown()).optional(),
		if: z.unknown().optional(),
		then: z.unknown().optional(),
		required: z.array(z.string()).optional(),
		properties: z.record(z.string(), z.unknown()).optional(),
		const: z.unknown().optional(),
		type: z.union([z.string(), z.array(z.string())]).optional(),
	}),
]);

/** The conditions a schema node states. A node that isn't there, or a boolean schema, doesn't state one the evaluator checks. */
function conditionsOf(node: unknown) {
	if (!node) return undefined;
	const parsed = SchemaNodeSchema.parse(node);
	return typeof parsed === "boolean" ? undefined : parsed;
}

function evaluateCondition(node: unknown, config: Record<string, unknown>, ctx: Pick<z.RefinementCtx, "addIssue">, rootDocs: unknown[], allowedKeys: Set<string>): boolean {
	const conditionObj = conditionsOf(node);
	if (!conditionObj) return true;
	let ok = true;

	// 1. resolve $ref
	if (conditionObj.$ref !== undefined) {
		const resolved = resolveRef(conditionObj.$ref, rootDocs);
		if (resolved) {
			ok = evaluateCondition(resolved, config, ctx, rootDocs, allowedKeys) && ok;
		} else {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unresolvable schema reference: ${conditionObj.$ref}`, path: [] });
			ok = false;
		}
		return ok; // If it's a $ref, JSON schema typically ignores siblings, but this stops here.
	}

	// 2. process allOf
	for (const rule of conditionObj.allOf ?? []) {
		ok = evaluateCondition(rule, config, ctx, rootDocs, allowedKeys) && ok;
	}

	if (conditionObj.anyOf) {
		const results = conditionObj.anyOf.map((rule) => evaluateBranch(rule, config, rootDocs));
		const passing = results.filter((result) => result.ok);
		if (passing.length === 0) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must match at least one schema in anyOf", path: [] });
			ok = false;
		} else {
			for (const result of passing) {
				for (const key of result.allowedKeys) {
					allowedKeys.add(key);
				}
			}
		}
	}

	if (conditionObj.oneOf) {
		const results = conditionObj.oneOf.map((rule) => evaluateBranch(rule, config, rootDocs));
		const passing = results.filter((result) => result.ok);
		const [only, ...others] = passing;
		if (!only || others.length > 0) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must match exactly one schema in oneOf", path: [] });
			ok = false;
		} else {
			for (const key of only.allowedKeys) {
				allowedKeys.add(key);
			}
		}
	}

	// 3. process if/then
	const ifProperties = conditionsOf(conditionObj.if)?.properties;
	if (ifProperties) {
		let matchesIf = true;
		for (const [k, v] of Object.entries(ifProperties)) {
			const constant = conditionsOf(v)?.const;
			if (constant !== undefined && config[k] !== constant) {
				matchesIf = false;
				break;
			}
		}
		if (matchesIf && conditionObj.then) {
			ok = evaluateCondition(conditionObj.then, config, ctx, rootDocs, allowedKeys) && ok;
		}
	}

	// 4. process required
	for (const req of conditionObj.required ?? []) {
		if (config[req] === undefined) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must have required property '${req}'`, path: [req] });
			ok = false;
		}
	}

	for (const [k, v] of Object.entries(conditionObj.properties ?? {})) {
		allowedKeys.add(k);
		const property = conditionsOf(v);
		if (config[k] !== undefined) {
			if (property?.const !== undefined && config[k] !== property.const) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must be equal to constant "${property.const}"`, path: [k] });
				ok = false;
			}
			if (property?.type === "number" && typeof config[k] !== "number") {
				// if it's string from env, parse it dynamically
				if (typeof config[k] === "string" && !isNaN(Number(config[k]))) {
					config[k] = Number(config[k]);
				} else {
					ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must be number`, path: [k] });
					ok = false;
				}
			}
		}
	}

	return ok;
}

function evaluateBranch(conditionObj: unknown, config: Record<string, unknown>, rootDocs: unknown[]) {
	let issued = 0;
	const branchAllowed = new Set<string>();
	const ok = evaluateCondition(conditionObj, config, { addIssue: () => issued++ }, rootDocs, branchAllowed);
	return { ok: ok && issued === 0, allowedKeys: branchAllowed };
}

/** A property's `enum`, where the policy states one. */
const StatedEnumSchema = z.looseObject({ enum: z.tuple([z.string()], z.string()).optional() });
/** The enumerations a policy's properties state for a config's place and for each directory filter's dir. */
const PolicyEnumsSchema = z.looseObject({
	place: StatedEnumSchema.optional(),
	dirFilters: z.looseObject({ items: z.looseObject({ properties: z.looseObject({ dir: StatedEnumSchema.optional() }).optional() }).optional() }).optional(),
});

/**
 * Validate a runtime config against a loaded policy.
 * Builds a strict Zod schema dynamically from the policy definition.
 */
function buildConfigValidator(policy: TRunPolicy) {
	const properties = PolicyEnumsSchema.parse(policy.properties ?? {});
	const validPlaces = properties.place?.enum;
	const validDirs = properties.dirFilters?.items?.properties?.dir?.enum;

	const place = validPlaces ? z.enum(validPlaces) : z.string();
	const dir = validDirs ? z.union([z.enum(validDirs), z.literal("*")]) : z.string();
	const ConfigValidator = z.looseObject({ place, dirFilters: z.array(z.object({ dir, access: z.enum(RUN_ACCESS_LEVELS) })) });

	return ConfigValidator.superRefine((config, ctx) => {
		// 1. Evaluate policy rules dynamically
		const rootDocs = [policy];

		// keys that are always allowed by the base schema
		const allowedKeys = new Set<string>();

		// Pre-populate allowedKeys with root properties
		allowedKeys.add("place");
		allowedKeys.add("dirFilters");
		if (policy.properties) Object.keys(policy.properties).forEach((k) => allowedKeys.add(k));

		evaluateCondition(policy, config, ctx, rootDocs, allowedKeys);

		// Validate strictness: block non-existent parameters
		for (const key of Object.keys(config)) {
			if (!allowedKeys.has(key)) {
				ctx.addIssue({
					code: z.ZodIssueCode.unrecognized_keys,
					keys: [key],
					message: `Unrecognized key(s) in object: '${key}'`,
					path: [],
				});
			}
		}

		// 2. Custom deny rule validation
		const { dirFilters } = config;
		if (dirFilters) {
			dirFilters.forEach((filter, index) => {
				const flat = { place: config.place, dir: filter.dir, access: filter.access };

				for (const rule of policy.deny) {
					const match = (!rule.place || rule.place === flat.place) && (!rule.dir || rule.dir === flat.dir) && (!rule.access || rule.access === flat.access);

					if (match) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `Filter "${filter.dir}:${filter.access}" in "${config.place}": Denied by policy: ${JSON.stringify(rule)}`,
							path: ["dirFilters", index],
						});
					}
				}
			});
		}
	});
}

/**
 * Validate a config against a loaded policy, returning array of error strings.
 */
export function validateRunPolicyConfig(config: TRunPolicyConfig, policy: TRunPolicy, schemaPath: string): string[] {
	const validator = buildConfigValidator(policy);
	const result = validator.safeParse(config);
	if (result.success) return [];

	return result.error.issues.map((err) => `${err.path.length ? "/" + err.path.join("/") + " " : ""}${err.message}`);
}

/** Load policy, validate config, throw on failure. */
export function loadAndValidateRunPolicy(config: TRunPolicyConfig, schemaPath: string): TRunPolicy {
	const policy = loadRunPolicy(schemaPath);
	const errors = validateRunPolicyConfig(config, policy, schemaPath);
	if (errors.length > 0) {
		const jsonContext = JSON.stringify({ $schema: schemaPath, ...config }, null, 2);
		throw new Error(`Run policy validation failed:\n${jsonContext}\n\nErrors:\n${errors.map((e) => `  • ${e}`).join("\\n")}`);
	}
	return policy;
}
