import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countFindings, expectWithinBaseline, type TFound } from "./baseline.js";

const TEST_FILE = "scripts/rule.test.ts";
const FIX = "fix the finding";
const UNPOSITIONED = "unpositioned";
const IMPORTS = "imports a view";
const FOUND: TFound[] = [
	{ file: "a.ts", finding: UNPOSITIONED },
	{ file: "b.ts", finding: IMPORTS, line: 7 },
	{ file: "b.ts", finding: IMPORTS, line: 9 },
];
const RECORDED = { "a.ts": { [UNPOSITIONED]: 1 }, "b.ts": { [IMPORTS]: 2 } };

let dir = "";
const baselineFile = () => join(dir, "rule.baseline.json");
const check = (found: readonly TFound[]) => expectWithinBaseline({ baselineFile: baselineFile(), found, testFile: TEST_FILE, fix: FIX });
/** Writes a baseline as the snapshot writes it: sorted, tab-indented, ending in a newline. */
const record = (findings: unknown) => writeFileSync(baselineFile(), `${JSON.stringify(findings, null, "\t")}\n`);

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "haibun-baseline-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("findings held to a baseline", () => {
	it("count each finding by its file and its name", () => {
		expect(countFindings(FOUND)).toEqual(RECORDED);
	});

	it("pass where each count equals its record", async () => {
		record(RECORDED);
		await expect(check(FOUND)).resolves.toBeUndefined();
	});

	it("fail where a count exceeds its record, listing the line of each finding of its kind in its file, and leave the record", async () => {
		const exceeded = { ...RECORDED, "b.ts": { [IMPORTS]: 1 } };
		record(exceeded);
		await expect(check(FOUND)).rejects.toThrow(/exceed what[\s\S]*b\.ts: imports a view 1 -> 2\n {4}b\.ts:7\n {4}b\.ts:9/);
		expect(JSON.parse(readFileSync(baselineFile(), "utf-8"))).toEqual(exceeded);
	});

	it("fail where a finding in a file the baseline doesn't name appears", async () => {
		record(RECORDED);
		await expect(check([...FOUND, { file: "c.ts", finding: UNPOSITIONED }])).rejects.toThrow(/c\.ts: unpositioned 0 -> 1/);
	});

	it("reject a baseline that doesn't hold positive whole counts by file", async () => {
		record({ "a.ts": { [UNPOSITIONED]: 0 } });
		await expect(check(FOUND)).rejects.toThrow(/doesn't hold findings by file/);
	});
});
