/**
 * The rules over a repository's text: a downstream application's name, apart from the file that states the names, a safety
 * check over a class expression stated as an absence, a read of pages without a bound, and a stepper's steps declared without
 * declareSteps.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { absenceCheckFindings, downstreamNameFindings, unboundedReadFindings, untypedStepsFindings, UNTYPED_STEPS } from "./surface-rules.js";

const repository = mkdtempSync(join(tmpdir(), "haibun-surface-"));
execFileSync("git", ["init", "-q"], { cwd: repository });
mkdirSync(join(repository, "features"));
/** The lines of a feature the rules read, each joined from its words, so this file doesn't state the checks it holds. */
const FEATURE = [["set none from exactly", "0 individuals of SeqPath"], ["didn't individual", "Step:s1 is a Note"], ["every Note is a prov:Entity"], ["Acme ships it"]];
writeFileSync(join(repository, "features", "a.feature"), FEATURE.map((words) => words.join(" ")).join("\n"));
writeFileSync(join(repository, "features", "rules.test.ts"), "names Acme");
afterAll(() => rmSync(repository, { recursive: true }));

describe("the rules over a repository's text", () => {
	it("finds a safety check stated as an absence, and leaves a positive check", () => {
		expect(absenceCheckFindings(repository, ["features"], []).map(({ line, finding }) => `${line} ${finding}`)).toEqual([
			"1 states a safety check as an absence of a class expression's members",
			"2 states a safety check as a negated membership",
		]);
	});

	it("finds a downstream name apart from the file that states the names", () => {
		const found = downstreamNameFindings(repository, ["features"], { names: ["Acme"], statedIn: "features/rules.test.ts" }, []);
		expect(found.map(({ file, line }) => `${file}:${line}`)).toEqual(["features/a.feature:4"]);
	});

	it("finds a read of pages without a bound, apart from an export and a test", () => {
		const unbounded = "readInPages(read, 0, Number.POSITIVE_INFINITY, 500);";
		const texts: Record<string, string> = {
			"src/reads.ts": unbounded,
			"src/bounded.ts": "readInPages(read, 0, LIMIT, 500);",
			"src/graph/pipelines/export-import.ts": unbounded,
			"src/reads.test.ts": unbounded,
		};
		const sources = new Map(Object.entries(texts).map(([file, text]) => [file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]));
		expect(unboundedReadFindings(sources).map(({ file, finding }) => `${file} ${finding}`)).toEqual(["src/reads.ts reads pages of records without a bound"]);
	});

	it("finds a stepper's steps set from an object literal or checked with satisfies, and leaves those declareSteps declares", () => {
		const texts: Record<string, string> = {
			"src/literal.ts": "class A { steps = { a: { gwta: 'a' } }; }",
			"src/satisfied.ts": "class B { steps = { b: { gwta: 'b' } } as const satisfies TStepperSteps; }",
			"src/declared-satisfied.ts": "class C { steps = declareSteps({ c: { gwta: 'c' } }) satisfies TStepperSteps; }",
			"src/declared.test.ts": "class D { steps = declareSteps({ d: { gwta: 'd' } }); }",
			"src/given.ts": "class E { steps = given; }",
		};
		const sources = new Map(Object.entries(texts).map(([file, text]) => [file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]));
		expect(untypedStepsFindings(sources).map(({ file }) => file)).toEqual(["src/literal.ts", "src/satisfied.ts", "src/declared-satisfied.ts"]);
		expect(new Set(untypedStepsFindings(sources).map(({ finding }) => finding))).toEqual(new Set([UNTYPED_STEPS]));
	});
});
