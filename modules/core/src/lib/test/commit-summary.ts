/**
 * What a commit's message states of the change it holds: the net lines of source code it adds, and the count of declared steps the
 * steps baseline records with the change from the count before it. The prepare-commit-msg hook appends both through
 * `haibun-commit-summary`.
 */
import type { TFindings } from "./baseline.js";
import { TEST_MODULE } from "./repository-files.js";
import { DECLARED_STEPS, REPOSITORY_FILE } from "./step-rules.js";

/** A file of code. */
const CODE = /\.(?:ts|tsx|mts|js|mjs|cjs)$/;
/** A feature or a waypoint background, which builds features. */
const FEATURE = /\.feature\.ts$|(^|\/)(features|backgrounds)\//;
/** A test group's directory: a module's or a repository's tests, and haibun's end-to-end tests. */
const GROUP_DIRECTORY = /(^|\/)(tests[^/]*|e2e-tests)\//;

/** Whether a file is source code, which a commit's net source lines count: code that isn't a test, a test fake, a feature or a
 *  waypoint background, and isn't in a test group's directory. */
export const isSourceCode = (file: string): boolean => CODE.test(file) && !TEST_MODULE.test(file) && !FEATURE.test(file) && !GROUP_DIRECTORY.test(file);

/** The net lines of source code that `git diff --numstat` output adds: the lines it adds less the lines it removes, of each source
 *  file whose change is text. */
export function netSourceLines(numstat: string): number {
	return numstat
		.split("\n")
		.map((line) => line.split("\t"))
		.filter(([added, , file]) => added !== "-" && file !== undefined && isSourceCode(file))
		.reduce((net, [added, removed]) => net + Number(added) - Number(removed), 0);
}

/** The count of declared steps a steps baseline's text records, or undefined where it doesn't record one. */
export function declaredSteps(baselineText: string | undefined): number | undefined {
	return baselineText === undefined ? undefined : (JSON.parse(baselineText) as TFindings)[REPOSITORY_FILE]?.[DECLARED_STEPS];
}

/** The lines a commit's message states: its net source lines, and its count of declared steps with the change from the count before
 *  it, where both baselines record one. */
export function commitSummary(numstat: string, stepsBefore: string | undefined, stepsAfter: string | undefined): string {
	const [before, after] = [declaredSteps(stepsBefore), declaredSteps(stepsAfter)];
	const delta = before === undefined || after === undefined ? "" : ` (${after - before >= 0 ? "+" : ""}${after - before})`;
	return `\nNet source lines: ${netSourceLines(numstat)}\nDeclared steps: ${after === undefined ? "unrecorded" : after}${delta}\n`;
}
