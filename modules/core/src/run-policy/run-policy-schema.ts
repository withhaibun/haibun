import { z } from 'zod';
import { readFileSync } from 'fs';
import { ACCESS_LEVELS, type TRunPolicyConfig } from './run-policy-types.js';

// ============================================================================
// Policy File Schema — Hierarchical JSON Schema
// ============================================================================

const DenyRuleSchema = z.object({
  place: z.string().optional(),
  dir: z.string().optional(),
  access: z.enum(ACCESS_LEVELS).optional(),
});

/**
 * Validates the policy file structure itself.
 * The structure mirrors TRunPolicyConfig (place + dirFilters array).
 */
const PolicyFileSchema = z.object({
  $schema: z.string().optional(),
  type: z.literal('object').default('object'),
  properties: z.object({}).passthrough().optional(),
  definitions: z.object({}).passthrough().optional(),
  $defs: z.object({}).passthrough().optional(),
  required: z.array(z.string()).optional(),
  allOf: z.array(z.unknown()).optional(),
  anyOf: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
  deny: z.array(DenyRuleSchema).default([]),
}).passthrough();

export type TRunPolicy = z.infer<typeof PolicyFileSchema>;

/** Load and parse a policy file */
export function loadRunPolicy(schemaPath: string): TRunPolicy {
  let raw: string;
  try {
    raw = readFileSync(schemaPath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read run policy "${schemaPath}": ${(err as Error).message}`);
  }
  return PolicyFileSchema.parse(JSON.parse(raw));
}

function resolveRef(ref: string, rootDocs: unknown[]): unknown {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.substring(2).split('/');
  for (const doc of rootDocs) {
    if (!doc) continue;
    let curr: unknown = doc;
    for (const part of parts) {
      if (typeof curr === 'object' && curr !== null && part in curr) {
        curr = (curr as Record<string, unknown>)[part];
      } else {
        curr = undefined;
        break;
      }
    }
    if (curr !== undefined) return curr;
  }
  return undefined;
}

function evaluateCondition(conditionObj: Record<string, unknown> | undefined, config: Record<string, unknown>, ctx: z.RefinementCtx, rootDocs: unknown[], allowedKeys: Set<string>): boolean {
  if (!conditionObj) return true;
  let ok = true;

  // 1. resolve $ref
  if (typeof conditionObj.$ref === 'string') {
    const resolved = resolveRef(conditionObj.$ref, rootDocs) as Record<string, unknown> | undefined;
    if (resolved) {
      ok = evaluateCondition(resolved, config, ctx, rootDocs, allowedKeys) && ok;
    } else {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unresolvable schema reference: ${conditionObj.$ref}`, path: [] });
      ok = false;
    }
    return ok; // If it's a $ref, JSON schema typically ignores siblings, but we'll stop here.
  }

  // 2. process allOf
  if (Array.isArray(conditionObj.allOf)) {
    for (const rule of conditionObj.allOf) {
      ok = evaluateCondition(rule as Record<string, unknown>, config, ctx, rootDocs, allowedKeys) && ok;
    }
  }

  if (Array.isArray(conditionObj.anyOf)) {
    const results = conditionObj.anyOf.map((rule) => evaluateBranch(rule as Record<string, unknown>, config, rootDocs));
    const passing = results.filter((result) => result.ok);
    if (passing.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must match at least one schema in anyOf', path: [] });
      ok = false;
    } else {
      for (const result of passing) {
        for (const key of result.allowedKeys) {
          allowedKeys.add(key);
        }
      }
    }
  }

  if (Array.isArray(conditionObj.oneOf)) {
    const results = conditionObj.oneOf.map((rule) => evaluateBranch(rule as Record<string, unknown>, config, rootDocs));
    const passing = results.filter((result) => result.ok);
    if (passing.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must match exactly one schema in oneOf', path: [] });
      ok = false;
    } else {
      for (const key of passing[0].allowedKeys) {
        allowedKeys.add(key);
      }
    }
  }

  // 3. process if/then
  if (conditionObj.if && typeof conditionObj.if === 'object' && 'properties' in conditionObj.if) {
    let matchesIf = true;
    for (const [k, v] of Object.entries((conditionObj.if as Record<string, unknown>).properties as Record<string, unknown>)) {
      const castV = v as Record<string, unknown>;
      if (castV.const !== undefined && config[k] !== castV.const) {
        matchesIf = false;
        break;
      }
    }
    if (matchesIf && conditionObj.then) {
      ok = evaluateCondition(conditionObj.then as Record<string, unknown>, config, ctx, rootDocs, allowedKeys) && ok;
    }
  }

  // 4. process required
  if (Array.isArray(conditionObj.required)) {
    for (const req of conditionObj.required) {
      if (config[req] === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must have required property '${req}'`, path: [req] });
        ok = false;
      }
    }
  }

  if (conditionObj.properties && typeof conditionObj.properties === 'object') {
    for (const [k, v] of Object.entries(conditionObj.properties as Record<string, unknown>)) {
      allowedKeys.add(k);
      const castV = v as Record<string, unknown>;
      if (config[k] !== undefined) {
        if (castV.const !== undefined && config[k] !== castV.const) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must be equal to constant "${castV.const}"`, path: [k] });
          ok = false;
        }
        if (castV.type === 'number' && typeof config[k] !== 'number') {
          // if it's string from env, parse it dynamically
          if (typeof config[k] === 'string' && !isNaN(Number(config[k]))) {
            config[k] = Number(config[k]);
          } else {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must be number`, path: [k] });
            ok = false;
          }
        }
      }
    }
  }

  return ok;
}

function evaluateBranch(conditionObj: Record<string, unknown>, config: Record<string, unknown>, rootDocs: unknown[]) {
  const issues: z.ZodIssue[] = [];
  const branchAllowed = new Set<string>();
  const ctx = {
    addIssue: (issue: z.ZodIssue) => {
      issues.push(issue);
    }
  } as z.RefinementCtx;
  const ok = evaluateCondition(conditionObj, config, ctx, rootDocs, branchAllowed);
  return { ok: ok && issues.length === 0, allowedKeys: branchAllowed, issues };
}

/**
 * Validate a runtime config against a loaded policy.
 * Builds a strict Zod schema dynamically from the policy definition.
 */
export function buildConfigValidator(policy: TRunPolicy) {
  const validPlaces = (policy.properties as Record<string, unknown>)?.place && ((policy.properties as Record<string, unknown>).place as Record<string, unknown>).enum as [string, ...string[]] | undefined;
  const validDirs = (policy.properties as Record<string, unknown>)?.dirFilters &&
    ((policy.properties as Record<string, unknown>).dirFilters as Record<string, unknown>).items &&
    (((policy.properties as Record<string, unknown>).dirFilters as Record<string, unknown>).items as Record<string, unknown>).properties &&
    ((((policy.properties as Record<string, unknown>).dirFilters as Record<string, unknown>).items as Record<string, unknown>).properties as Record<string, unknown>).dir &&
    (((((policy.properties as Record<string, unknown>).dirFilters as Record<string, unknown>).items as Record<string, unknown>).properties as Record<string, unknown>).dir as Record<string, unknown>).enum as [string, ...string[]] | undefined;

  const baseSchema: Record<string, z.ZodTypeAny> = {};
  if (validPlaces) {
    baseSchema.place = z.enum(validPlaces);
  } else {
    baseSchema.place = z.string();
  }

  if (validDirs) {
    baseSchema.dirFilters = z.array(z.object({
      dir: z.union([z.enum(validDirs), z.literal('*')]),
      access: z.enum(ACCESS_LEVELS),
    }));
  } else {
    baseSchema.dirFilters = z.array(z.object({
      dir: z.string(),
      access: z.enum(ACCESS_LEVELS),
    }));
  }

  const ConfigValidator = z.object(baseSchema).passthrough();

  return ConfigValidator.superRefine((config, ctx) => {
    // 1. Evaluate policy rules dynamically
    const rootDocs = [policy];

    // keys that are always allowed by the base schema
    const allowedKeys = new Set<string>();

    // Pre-populate allowedKeys with root properties
    allowedKeys.add('place');
    allowedKeys.add('dirFilters');
    if (policy.properties) Object.keys(policy.properties as Record<string, unknown>).forEach(k => allowedKeys.add(k));

    evaluateCondition(policy as Record<string, unknown>, config, ctx, rootDocs, allowedKeys);

    // Validate strictness: block non-existent parameters
    for (const key of Object.keys(config)) {
      if (!allowedKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.unrecognized_keys,
          keys: [key],
          message: `Unrecognized key(s) in object: '${key}'`,
          path: []
        });
      }
    }

    // 2. Custom deny rule validation
    const dirFilters = config.dirFilters as Record<string, unknown>[];
    if (dirFilters) {
      dirFilters.forEach((filter: Record<string, unknown>, index: number) => {
        const flat = { place: config.place, dir: filter.dir, access: filter.access };

        for (const rule of policy.deny) {
          const match = (!rule.place || rule.place === flat.place)
            && (!rule.dir || rule.dir === flat.dir)
            && (!rule.access || rule.access === flat.access);

          if (match) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Filter "${filter.dir}:${filter.access}" in "${config.place}": Denied by policy: ${JSON.stringify(rule)}`,
              path: ['dirFilters', index]
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

  return result.error.issues.map((err) => `${err.path.length ? '/' + err.path.join('/') + ' ' : ''}${err.message}`);
}

/** Load policy, validate config, throw on failure. */
export function loadAndValidateRunPolicy(config: TRunPolicyConfig, schemaPath: string): TRunPolicy {
  const policy = loadRunPolicy(schemaPath);
  const errors = validateRunPolicyConfig(config, policy, schemaPath);
  if (errors.length > 0) {
    const jsonContext = JSON.stringify({ $schema: schemaPath, ...config }, null, 2);
    throw new Error(`Run policy validation failed:\n${jsonContext}\n\nErrors:\n${errors.map((e) => `  • ${e}`).join('\\n')}`);
  }
  return policy;
}
