/**
 * The rules over a repository's text: a downstream application's name, apart from the file that states the names, and a safety
 * check over a class expression stated as an absence.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { absenceCheckFindings, downstreamNameFindings } from "./surface-rules.js";

const repository = mkdtempSync(join(tmpdir(), "haibun-surface-"));
execFileSync("git", ["init", "-q"], { cwd: repository });
mkdirSync(join(repository, "features"));
/** The lines of a feature the rules read, each joined from its words, so this file doesn't state the checks it holds. */
const FEATURE = [["set none from exactly", "0 individuals of SeqPath"], ["not individual", "Step:s1 is a Note"], ["every Note is a prov:Entity"], ["Acme ships it"]];
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
});
