import { describe, expect, it } from "vitest";
import { commitSummary, isSourceCode, netSourceLines } from "./commit-summary.js";

const STEPS = (count: number) => JSON.stringify({ ".": { "declares steps": count } });

describe("a commit's summary", () => {
	it("counts source code, apart from tests, fakes, features, waypoint backgrounds and a test group's files", () => {
		expect(["modules/core/src/a.ts", "scripts/run.mjs", "modules/tooling/bin/x.js"].every(isSourceCode)).toBe(true);
		const notSource = ["src/a.test.ts", "src/a.test-fake.ts", "src/test/kit.ts", "x/a.feature.ts", "w/backgrounds/b.ts", "tests-env/x.ts", "e2e-tests/src/s.ts", "README.md"];
		expect(notSource.filter(isSourceCode)).toEqual([]);
	});

	it("states the net source lines a staged change adds and the declared steps with their change", () => {
		const numstat = ["10\t2\tmodules/core/src/a.ts", "5\t0\tsrc/a.test.ts", "-\t-\tassets/image.png", "1\t4\tscripts/run.mjs"].join("\n");
		expect(netSourceLines(numstat)).toBe(5);
		expect(commitSummary(numstat, STEPS(218), STEPS(216))).toBe("\nNet source lines: 5\nDeclared steps: 216 (-2)\n");
		expect(commitSummary("", undefined, STEPS(3))).toBe("\nNet source lines: 0\nDeclared steps: 3\n");
		expect(commitSummary("", undefined, undefined)).toBe("\nNet source lines: 0\nDeclared steps: unrecorded\n");
	});
});
