/**
 * The typed step graph a set of steppers declares, held to the findings a baseline file records. Each parameter names
 * the domain of what its value is and each step names the domain of its products, and the chain lint reports where
 * they don't. A finding the file doesn't record fails, naming it and what fixes it; a finding the file records that is
 * gone fails too, naming it, so the file is edited to record the improvement. The graph only improves, and the file
 * states where it stands. A stepper in the source that the test doesn't hold to its file fails as well, naming it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { CStepper } from "../astepper.js";
import { DEF_PROTO_OPTIONS, getTestWorldWithOptions } from "./lib.js";
import { createSteppers, setStepperWorldsAndDomains } from "../util/index.js";
import { addStepperConcerns } from "../../phases/Executor.js";
import { buildDomainChain } from "../domain-chain.js";
import { LINT_FINDING, lintDomainChain, lintFindingLine, type TLintFinding } from "../domain-chain-lint.js";

/** What fixes each kind of finding. */
const FIX: Record<TLintFinding["kind"], string> = {
	[LINT_FINDING.STRING_PARAM]: "name the domain of what the value is in the step's phrase",
	[LINT_FINDING.UNSUPPLIED_STEP]: "declare the step that produces the domain",
	[LINT_FINDING.UNREACHABLE_DOMAIN]: "declare a step that consumes or produces the domain, or remove it",
	[LINT_FINDING.UNPRODUCED_DOMAIN]: "declare the step that produces the domain",
};

type TStepGraphBaseline = {
	/** The steppers held to the file: every stepper class the source declares. */
	owned: CStepper[];
	/** Steppers loaded beside them, whose domains they use, and whose findings belong to another file. */
	alongside?: CStepper[];
	/** Stepper classes the source declares that a run doesn't load as they are, each with why. */
	unloaded?: { stepper: CStepper; why: string }[];
	moduleOptions?: Record<string, string>;
	/** The JSON array of finding lines the steppers' graph is held to. */
	baselineFile: string;
	/** Where the owned steppers' source is, read for stepper classes the test doesn't hold. */
	sourceDir: string;
};

/** The chain lint's findings about `owned`, set up beside `alongside` as a run sets its steppers up, each as a line, sorted. */
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

/** Hold the step graph of `owned` to what `baselineFile` records, and every stepper class under `sourceDir` to it. */
export async function expectStepGraphAsRecorded(baseline: TStepGraphBaseline): Promise<void> {
	const held = [...baseline.owned, ...(baseline.unloaded ?? []).map(({ stepper }) => stepper)];
	const unheld = stepperClassesIn(baseline.sourceDir).filter((name) => !held.some((stepper) => stepper.name === name));
	if (unheld.length > 0) throw new Error(`steppers under ${baseline.sourceDir} aren't held to ${baseline.baselineFile}: add ${unheld.join(", ")} to the test's owned steppers`);
	const findings = await stepGraphFindings(baseline);
	if (!existsSync(baseline.baselineFile)) {
		throw new Error(
			`no baseline at ${baseline.baselineFile}: it records the step graph's findings as a JSON array of lines, which are now:\n${JSON.stringify(findings, null, "\t")}`,
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
						`The typed step graph no longer has findings ${baseline.baselineFile} records. Remove them from the file, which then records the improvement:`,
						...gone.map((line) => `  - ${line}`),
					]
				: []),
		].join("\n"),
	);
}

/** The stepper classes a source directory declares, outside its tests. */
function stepperClassesIn(dir: string): string[] {
	const classes: string[] = [];
	for (const entry of readdirSync(dir)) {
		const at = path.join(dir, entry);
		if (statSync(at).isDirectory()) {
			if (entry !== "test" && entry !== "node_modules") classes.push(...stepperClassesIn(at));
			continue;
		}
		if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || entry.includes("test-fake") || entry.endsWith(".d.ts")) continue;
		for (const match of readFileSync(at, "utf-8").matchAll(/^(?:export (?:default )?)?class (\w+) extends (?:AStepper|AStorage)\b/gm)) classes.push(match[1]);
	}
	return classes.sort();
}
