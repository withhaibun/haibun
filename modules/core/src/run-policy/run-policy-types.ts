import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/** CLI option name for run-policy */
export const OPTION_RUN_POLICY = '--run-policy';

/** CLI option for dry-run mode (preview which features pass/fail the run policy) */
export const OPTION_DRY_RUN = '--dry-run';

/** Environment variable for run-policy (format: "env dir:access[,dir:access]") */
export const HAIBUN_RUN_POLICY = 'HAIBUN_RUN_POLICY';

/** Valid access levels, forming a strict hierarchy: r ⊂ a ⊂ w */
export const ACCESS_LEVELS = ['r', 'a', 'w'] as const;

/** Feature filename prefixes corresponding to access levels */
export const ACCESS_PREFIXES = ['r_', 'a_', 'w_'] as const;

// ============================================================================
// Zod Schemas — types are inferred, parsing via transforms
// ============================================================================

// Basic types
const InputAccessLevelSchema = z.string();
export const AccessLevelSchema = z.enum(ACCESS_LEVELS);
export type AccessLevel = z.infer<typeof AccessLevelSchema>;

export type TDirFilter = {
  dir: string;
  access: string;
};

export type TRunPolicyConfig = {
  env: string;
  dirFilters: TDirFilter[];
};

/** Parses "smoke:r" → { dir: "smoke", access: "r" } */
export const DirFilterSchema = z.string()
  .transform((val, ctx) => {
    const parts = val.split(':');
    if (parts.length !== 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid filter format "${val}". Expected "dir:access"` });
      return z.NEVER;
    }
    return { dir: parts[0], access: parts[1] };
  })
  .pipe(z.object({ dir: z.string().min(1), access: InputAccessLevelSchema }));

/** Parse dir:access[,dir:access] string */
export function parseDirFilters(input: string): TDirFilter[] {
  return input.split(',').map(s => DirFilterSchema.parse(s));
}

export const RunPolicyConfigSchema = z.object({
  env: z.string().min(1),
  dirAccessStr: z.string(),
}).transform((data): TRunPolicyConfig => {
  const dirFilters = parseDirFilters(data.dirAccessStr);
  return { env: data.env, dirFilters };
});

// ============================================================================
// Parsing — thin wrappers delegating to Zod
// ============================================================================

/** Parse --run-policy arguments: env dir:access[,dir:access] */
export function parseRunPolicyArgs(env: string, dirAccessStr: string): TRunPolicyConfig {
  try {
    return RunPolicyConfigSchema.parse({ env, dirAccessStr });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const detail = e.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Run policy configuration failed:\n${detail}`);
    }
    throw e;
  }
}

/** Parse HAIBUN_RUN_POLICY env var: "env dir:access[,dir:access]" */
export function parseRunPolicyEnv(envVar: string): TRunPolicyConfig {
  const parts = envVar.trim().split(/\s+/);
  if (parts.length !== 2) {
    throw new Error(`Invalid format. Expected "env dir:access"`);
  }
  return parseRunPolicyArgs(parts[0], parts[1]);
}

// ============================================================================
// Access Level Logic — minimal procedural (pure domain logic)
// ============================================================================

/** Numeric rank for hierarchy comparison: r=0, a=1, w=2 */
export function accessRank(level: string): number {
  return ACCESS_LEVELS.indexOf(level as AccessLevel);
}

/** Check if granted level includes required level (w ⊃ a ⊃ r) */
export function accessLevelIncludes(granted: string, required: string): boolean {
  return accessRank(granted) >= accessRank(required);
}

/** Extract access prefix from feature filename, or undefined if unrecognized */
export function getFeatureAccessPrefix(filename: string): AccessLevel | undefined {
  const result = AccessLevelSchema.safeParse(filename.charAt(0));
  return result.success && filename.charAt(1) === '_' ? result.data : undefined;
}

// ============================================================================
// Feature Matching — runtime matching (must be procedural)
// ============================================================================

/**
 * Determine if a feature file should run given the active dir filters.
 * Exclusive: only features with a recognized prefix in a listed directory pass.
 */
export function featureMatchesFilter(featurePath: string, dirFilters: TDirFilter[]): boolean {
  const parts = featurePath.replace(/^\//, '').split('/');
  const filename = parts[parts.length - 1];
  const featureDir = parts.length > 1 ? parts[0] : undefined;

  const requiredAccess = getFeatureAccessPrefix(filename);
  if (!requiredAccess) return false;

  const matchingFilter = dirFilters.find((f) => f.dir === featureDir);
  if (!matchingFilter) return false;

  return accessLevelIncludes(matchingFilter.access, requiredAccess);
}
