import { z } from "zod";
import { itemAt } from "../../lib/domains/item-at.js";

// ============================================================================
// Constants
// ============================================================================

/** CLI option name for run-policy */
export const OPTION_RUN_POLICY = "--run-policy";

/** CLI option that lists the features that a run policy and a feature filter select. The process then exits without executing them. */
export const OPTION_DRY_RUN = "--dry-run";

/** Environment variable that holds a run policy as "place dir:access[,dir:access]" */
export const HAIBUN_RUN_POLICY = "HAIBUN_RUN_POLICY";

/** Run access levels name the operations a feature may perform on the place that a run targets. They form a strict hierarchy: read ⊂ act ⊂ write.
 *  They are distinct from the storage access levels (`private`/`public`/`opened`). A storage access level determines who may read a record.
 *  The name RUN_ACCESS_LEVELS differs from the storage names `AccessLevel` and `Access`, so each import names the kind of level it reads. */
export const RUN_ACCESS_LEVELS = ["r", "a", "w"] as const;

// ============================================================================
// Zod schemas: transforms parse the input strings
// ============================================================================

// Basic types
const InputAccessLevelSchema = z.string();
const RunAccessSchema = z.enum(RUN_ACCESS_LEVELS);
type TRunAccess = z.infer<typeof RunAccessSchema>;

export type TDirFilter = { dir: string; access: string };

export type TRunPolicyConfig = { place: string; dirFilters: TDirFilter[]; [param: string]: unknown };

/** Parses "smoke:r" → { dir: "smoke", access: "r" } */
const DirFilterSchema = z
	.string()
	.transform((val, ctx) => {
		const parts = val.split(":");
		if (parts.length !== 2) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Dir filter "${val}" doesn't have the form "dir:access". Write a directory, a colon and an access level, such as "smoke:r".`,
			});
			return z.NEVER;
		}
		return { dir: parts[0], access: parts[1] };
	})
	.pipe(z.object({ dir: z.string().min(1), access: InputAccessLevelSchema }));

/** Parse dir:access[,dir:access] string */
export function parseDirFilters(input: string): TDirFilter[] {
	return input.split(",").map((s) => DirFilterSchema.parse(s));
}

const RunPolicyConfigSchema = z
	.object({ place: z.string().min(1), dirAccessStr: z.string() })
	.catchall(z.unknown())
	.transform((data): TRunPolicyConfig => {
		const dirFilters = parseDirFilters(data.dirAccessStr);
		const result: Record<string, unknown> = { ...data };
		delete result.dirAccessStr;
		result.dirFilters = dirFilters;
		return result as TRunPolicyConfig;
	});

// ============================================================================
// Parsing: functions that call the Zod schemas
// ============================================================================

/** Parse --run-policy arguments: place dir:access[,dir:access] */
export function parseRunPolicyArgs(place: string, dirAccessStr: string): TRunPolicyConfig {
	try {
		return RunPolicyConfigSchema.parse({ place, dirAccessStr });
	} catch (e) {
		if (e instanceof z.ZodError) {
			const detail = e.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
			throw new Error(`Run policy parsing failed:\n${detail}\nWrite a run policy as "place dir:access[,dir:access]", such as "prod smoke:r".`);
		}
		throw e;
	}
}

/** Parse HAIBUN_RUN_POLICY env var: "place dir:access[,dir:access]" */
export function parseRunPolicyEnv(envVar: string): TRunPolicyConfig {
	const parts = envVar.trim().split(/\s+/);
	if (parts.length !== 2) {
		throw new Error(
			`HAIBUN_RUN_POLICY doesn't have the form "place dir:access[,dir:access]". Write the place and the dir filters with a space between them, such as "prod smoke:r".`,
		);
	}
	return parseRunPolicyArgs(itemAt(parts, 0), itemAt(parts, 1));
}

// ============================================================================
// Run access levels: comparison and feature filename prefixes
// ============================================================================

/** Numeric rank for hierarchy comparison: r=0, a=1, w=2 */
function accessRank(level: string): number {
	return RUN_ACCESS_LEVELS.indexOf(level as TRunAccess);
}

/** Check if granted level includes required level (w ⊃ a ⊃ r) */
export function accessLevelIncludes(granted: string, required: string): boolean {
	return accessRank(granted) >= accessRank(required);
}

/** Extract access prefix from feature filename, or undefined if unrecognized */
export function getFeatureAccessPrefix(filename: string): TRunAccess | undefined {
	const result = RunAccessSchema.safeParse(filename.charAt(0));
	return result.success && filename.charAt(1) === "_" ? result.data : undefined;
}

// ============================================================================
// Feature matching against dir filters
// ============================================================================

/**
 * Returns whether the dir filters select the feature file.
 * A selected filename starts with a run access prefix: `r_`, `a_` or `w_`.
 * The filter for the feature's top-level directory applies. The `*` filter applies when the dir filters don't list that directory.
 * The applied filter grants the prefix's access level or a higher one.
 */
export function featureMatchesFilter(featurePath: string, dirFilters: TDirFilter[]): boolean {
	const parts = featurePath.replace(/^\//, "").split("/");
	const filename = itemAt(parts, parts.length - 1);
	const featureDir = parts.length > 1 ? parts[0] : undefined;

	const requiredAccess = getFeatureAccessPrefix(filename);
	if (!requiredAccess) return false;

	const matchingFilter = dirFilters.find((f) => f.dir === featureDir) ?? dirFilters.find((f) => f.dir === "*");
	if (!matchingFilter) return false;

	return accessLevelIncludes(matchingFilter.access, requiredAccess);
}
