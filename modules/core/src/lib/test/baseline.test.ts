import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectWithinBaseline, LOWER_BASELINE, lowerCommand, type TFound } from "./baseline.js";

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
const record = (findings: unknown) => writeFileSync(baselineFile(), JSON.stringify(findings));
const lowering = () => vi.stubEnv(LOWER_BASELINE, "true");

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "haibun-baseline-"));
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

describe("findings held to a baseline", () => {
	it("fail where the baseline doesn't exist, naming the command that writes it", () => {
		expect(() => check(FOUND)).toThrow(lowerCommand(TEST_FILE));
	});

	it("are written by the command where the baseline doesn't exist, counted by file and finding", () => {
		lowering();
		check(FOUND);
		expect(JSON.parse(readFileSync(baselineFile(), "utf-8"))).toEqual(RECORDED);
	});

	it("pass where each count equals its record", () => {
		record(RECORDED);
		expect(() => check(FOUND)).not.toThrow();
	});

	it("fail where a count rises, listing the line of each finding of its kind in its file", () => {
		record({ ...RECORDED, "b.ts": { [IMPORTS]: 1 } });
		expect(() => check(FOUND)).toThrow(/rose above[\s\S]*b\.ts: imports a view 1 -> 2\n {4}b\.ts:7\n {4}b\.ts:9/);
	});

	it("fail where a finding in a file the baseline doesn't name appears", () => {
		record(RECORDED);
		expect(() => check([...FOUND, { file: "c.ts", finding: UNPOSITIONED }])).toThrow(/c\.ts: unpositioned 0 -> 1/);
	});

	it("fail where a count falls, naming the command that writes the lower count", () => {
		record({ ...RECORDED, "a.ts": { [UNPOSITIONED]: 2 } });
		expect(() => check(FOUND)).toThrow(new RegExp(`fell below[\\s\\S]*${lowerCommand(TEST_FILE)}[\\s\\S]*a\\.ts: unpositioned 2 -> 1`));
	});

	it("are lowered by the command where a count fell", () => {
		record({ ...RECORDED, "c.ts": { [UNPOSITIONED]: 1 } });
		lowering();
		check(FOUND);
		expect(JSON.parse(readFileSync(baselineFile(), "utf-8"))).toEqual(RECORDED);
	});

	it("aren't written by the command where a count rose", () => {
		const rose = { "a.ts": { [UNPOSITIONED]: 1 } };
		record(rose);
		lowering();
		expect(() => check(FOUND)).toThrow(/writes only lower counts[\s\S]*b\.ts: imports a view 0 -> 2/);
		expect(JSON.parse(readFileSync(baselineFile(), "utf-8"))).toEqual(rose);
	});

	it("reject a baseline that doesn't hold positive whole counts by file", () => {
		record({ "a.ts": { [UNPOSITIONED]: 0 } });
		expect(() => check(FOUND)).toThrow(/doesn't hold findings by file/);
	});
});
