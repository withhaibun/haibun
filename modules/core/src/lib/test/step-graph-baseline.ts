/**
 * Compares the typed step graph that a set of steppers declares with the findings a baseline file records. The chain
 * lint reports each way the graph is incomplete as a finding (`LINT_FINDING`). A finding that the file doesn't record
 * fails the test, and the error names the finding and its fix. A recorded finding that the graph doesn't have fails the
 * test too. That error names the finding. Removing it from the file records the improvement. The file holds the graph's
 * current findings, and the test rejects a new one. A stepper class in the source that `owned` and `unloaded` don't
 * list fails the test, and the error names it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { AStepper, CStepper } from "../steps/domains/stepper.js";
import { DEF_PROTO_OPTIONS, getTestWorldWithOptions } from "./lib.js";
import { createSteppers, setStepperWorldsAndDomains } from "../util/index.js";
import { itemAt } from "../util/item-at.js";
import { addStepperConcerns } from "../actuality/pipelines/executor.js";
import { buildDomainChain } from "../domain-chain.js";
import { LINT_FINDING, lintDomainChain, lintFindingLine, type TLintFinding } from "../domain-chain-lint.js";

/** What fixes each kind of finding. */
const FIX: Record<TLintFinding["kind"], string> = {
	[LINT_FINDING.STRING_PARAM]: "name the value's domain in the step's phrase",
	[LINT_FINDING.UNSUPPLIED_STEP]: "declare the step that produces the domain",
	[LINT_FINDING.UNREACHABLE_DOMAIN]: "declare a step that consumes or produces the domain, or remove it",
	[LINT_FINDING.UNPRODUCED_DOMAIN]: "declare the step that produces the domain",
};

type TStepGraphBaseline = {
	/** The steppers whose findings the file records. They and `unloaded` list every stepper class the source declares. */
	owned: CStepper[];
	/** Steppers loaded beside `owned` that declare domains `owned` uses. The test excludes their findings. The baseline
	 *  file of their own module records those findings. */
	alongside?: CStepper[];
	/** Stepper classes the source declares that actuality doesn't load from a stepper list. `why` states the reason for
	 *  each. Such a class may take constructor arguments. The test doesn't lint them. */
	unloaded?: { stepper: new (...args: never[]) => AStepper; why: string }[];
	moduleOptions?: Record<string, string>;
	/** The path of a JSON file that holds the expected finding lines as an array. */
	baselineFile: string;
	/** The directory of the owned steppers' source. The test reads it for stepper classes that `owned` and `unloaded` don't list. */
	sourceDir: string;
};

/** Returns the chain lint's findings about `owned` as sorted lines. It sets up `owned` beside `alongside` as actuality sets up its steppers. */
async function stepGraphFindings({ owned, alongside = [], moduleOptions = {} }: Omit<TStepGraphBaseline, "baselineFile" | "sourceDir" | "unloaded">): Promise<string[]> {
	const world = getTestWorldWithOptions({ ...DEF_PROTO_OPTIONS, moduleOptions });
	const steppers = createSteppers([...alongside, ...owned]);
	await setStepperWorldsAndDomains(steppers, world);
	addStepperConcerns(world, steppers);
	const names = new Set(owned.map((stepper) => stepper.name));
	const report = lintDomainChain(buildDomainChain(steppers, world.domains), world.domains);
	const about = (finding: TLintFinding) => ("stepperName" in finding ? finding.stepperName : world.domains[finding.domain]?.stepperName);
	return report.findings
		.filter((finding) => names.has(about(finding) ?? ""))
		.map(lintFindingLine)
		.sort();
}

/** Throws when `owned` and `unloaded` don't list a stepper class under `sourceDir`. Throws when `baselineFile` doesn't exist.
 *  Throws when the findings about `owned` differ from the lines `baselineFile` records. */
export async function expectStepGraphAsRecorded(baseline: TStepGraphBaseline): Promise<void> {
	const held = [...baseline.owned, ...(baseline.unloaded ?? []).map(({ stepper }) => stepper)];
	const unheld = stepperClassesIn(baseline.sourceDir).filter((name) => !held.some((stepper) => stepper.name === name));
	if (unheld.length > 0) throw new Error(`${baseline.sourceDir} holds steppers the test of ${baseline.baselineFile} doesn't list: add ${unheld.join(", ")} to owned or unloaded`);
	const findings = await stepGraphFindings(baseline);
	if (!existsSync(baseline.baselineFile)) {
		throw new Error(
			`${baseline.baselineFile} doesn't exist. Create it with the step graph's current findings as a JSON array of finding lines:\n${JSON.stringify(findings, null, "\t")}`,
		);
	}
	const recorded = JSON.parse(readFileSync(baseline.baselineFile, "utf-8")) as string[];
	const added = findings.filter((line) => !recorded.includes(line));
	const gone = recorded.filter((line) => !findings.includes(line));
	if (added.length === 0 && gone.length === 0) return;
	const kindOf = (line: string) => line.split(" ")[0] as TLintFinding["kind"];
	throw new Error(
		[
			...(added.length > 0
				? [`The typed step graph has findings ${baseline.baselineFile} doesn't record. Fix each:`, ...added.map((line) => `  + ${line}: ${FIX[kindOf(line)]}`)]
				: []),
			...(gone.length > 0
				? [
						`${baseline.baselineFile} records findings that the typed step graph doesn't have. Remove them from the file to record the improvement:`,
						...gone.map((line) => `  - ${line}`),
					]
				: []),
		].join("\n"),
	);
}

/** Returns the names of the classes under `dir` that extend AStepper or AStorage. It skips `test` and `node_modules`
 *  directories, test files, test fakes and declaration files. */
function stepperClassesIn(dir: string): string[] {
	const classes: string[] = [];
	for (const entry of readdirSync(dir)) {
		const at = path.join(dir, entry);
		if (statSync(at).isDirectory()) {
			if (entry !== "test" && entry !== "node_modules") classes.push(...stepperClassesIn(at));
			continue;
		}
		if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || entry.includes("test-fake") || entry.endsWith(".d.ts")) continue;
		for (const match of readFileSync(at, "utf-8").matchAll(/^(?:export (?:default )?)?class (\w+) extends (?:AStepper|AStorage)\b/gm)) classes.push(itemAt(match, 1));
	}
	return classes.sort();
}
