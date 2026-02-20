import { z } from 'zod';
import { readFileSync } from 'fs';
import { ACCESS_LEVELS, type TRunPolicyConfig } from './run-policy-types.js';

// ============================================================================
// Policy File Schema — Hierarchical JSON Schema
// ============================================================================

const DenyRuleSchema = z.object({
  env: z.string().optional(),
  dir: z.string().optional(),
  access: z.enum(ACCESS_LEVELS).optional(),
});

/**
 * Validates the policy file structure itself.
 * The structure mirrors TRunPolicyConfig (env + dirFilters array).
 */
const PolicyFileSchema = z.object({
  type: z.literal('object').default('object'),
  properties: z.object({
    env: z.object({
      type: z.literal('string').default('string'),
      enum: z.array(z.string()).min(1, 'At least one environment required'),
    }).passthrough(),
    dirFilters: z.object({
      type: z.literal('array').default('array'),
      items: z.object({
        type: z.literal('object').default('object'),
        properties: z.object({
          dir: z.object({
            type: z.literal('string').default('string'),
            enum: z.array(z.string()).min(1, 'At least one directory required'),
          }).passthrough(),
          access: z.object({
            type: z.literal('string').default('string'),
            enum: z.array(z.enum(ACCESS_LEVELS)).optional(),
          }).passthrough().optional()
        }).passthrough(),
        required: z.array(z.string()).optional()
      }).passthrough()
    }).passthrough()
  }).passthrough(),
  deny: z.array(DenyRuleSchema).default([]),
}).passthrough();

export type TRunPolicy = z.infer<typeof PolicyFileSchema>;

// ============================================================================
// Validation — Hierarchical Object Validation
// ============================================================================

/**
 * Build a Zod validator for the entire TRunPolicyConfig based on the policy.
 * This validator checks the whole config object at once ("wholesale validation").
 */
export function buildConfigValidator(policy: TRunPolicy) {
  const validEnvs = policy.properties.env.enum as [string, ...string[]];
  const validDirs = policy.properties.dirFilters.items.properties.dir.enum as [string, ...string[]];

  const ConfigValidator = z.object({
    env: z.enum(validEnvs),
    dirFilters: z.array(z.object({
      dir: z.enum(validDirs),
      access: z.enum(ACCESS_LEVELS),
    })),
  }).passthrough();

  // Apply deny rules via superRefine on the whole object
  return ConfigValidator.superRefine((data, ctx) => {
    if (!data.dirFilters) return;

    data.dirFilters.forEach((filter, index) => {
      const flat = { env: data.env, dir: filter.dir, access: filter.access };

      for (const rule of policy.deny) {
        const match = (!rule.env || rule.env === flat.env)
          && (!rule.dir || rule.dir === flat.dir)
          && (!rule.access || rule.access === flat.access);

        if (match) {
          ctx.addIssue({
            code: 'custom',
            path: ['dirFilters', index],
            message: `Denied by policy: ${JSON.stringify(rule)}`,
          });
        }
      }
    });
  });
}

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

/**
 * Validate a runtime config against a loaded policy.
 * Uses the generated Zod validator to check the config wholesale.
 */
export function validateRunPolicyConfig(config: TRunPolicyConfig, policy: TRunPolicy, schemaPath: string): string[] {
  const validator = buildConfigValidator(policy);
  const objectToValidate = { $schema: schemaPath, ...config };
  const result = validator.safeParse(objectToValidate);

  if (!result.success) {
    return result.error.issues.map((issue) => {
      if (issue.path[0] === 'dirFilters' && typeof issue.path[1] === 'number') {
        const idx = issue.path[1];
        const f = config.dirFilters[idx];
        const filterStr = f ? `${f.dir}:${f.access}` : 'unknown';
        const reason = issue.message.replace(/Expected .*, received/, 'Invalid').replace(/'/g, '"');
        return `Filter "${filterStr}" in "${config.env}": ${reason}`;
      }
      return issue.message;
    });
  }
  return [];
}

/** Load policy, validate config, throw on failure. */
export function loadAndValidateRunPolicy(config: TRunPolicyConfig, schemaPath: string): TRunPolicy {
  const policy = loadRunPolicy(schemaPath);
  const errors = validateRunPolicyConfig(config, policy, schemaPath);
  if (errors.length > 0) {
    const jsonContext = JSON.stringify({ $schema: schemaPath, ...config }, null, 2);
    throw new Error(`Run policy validation failed:\n${jsonContext}\n\nErrors:\n${errors.map((e) => `  • ${e}`).join('\n')}`);
  }
  return policy;
}
