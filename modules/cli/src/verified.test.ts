// The record of what a group has passed against, and the decision it answers.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { forgetOutcome, forgetOutcomes, outcomeAgainst, recordOutcome, runConditions, verificationOf } from "./verified.js";

/** A group of features in a repository of its own, with no steppers, so its only dependency is itself. */
function aGroup(): { dir: string; config: string } {
	const dir = nodeFS.realpathSync(nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-verified-")));
	execFileSync("git", ["init", "-q"], { cwd: dir });
	nodeFS.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ steppers: [] }));
	nodeFS.mkdirSync(path.join(dir, "features"));
	nodeFS.writeFileSync(path.join(dir, "features/a.feature"), "Feature: a\n");
	return { dir, config: path.join(dir, "config.json") };
}
const specl = { steppers: [] };
const conditions = (dir: string, config: string, more: Partial<Parameters<typeof verificationOf>[0]> = {}) => ({
	configPath: config,
	specl,
	bases: [dir],
	cwd: dir,
	filter: [],
	options: {},
	moduleOptions: {},
	...more,
});

describe("how a group last ran against its state", () => {
	it("has no run until one is recorded, has one against the state it was recorded for, and loses it when a dependency changes", () => {
		const { dir, config } = aGroup();
		const v = () => verificationOf(conditions(dir, config));
		expect(outcomeAgainst(v() as never)).toBeUndefined();
		recordOutcome(v() as never, "passed", 1);
		expect(outcomeAgainst(v() as never)).toEqual({ outcome: "passed", features: 1 });
		nodeFS.writeFileSync(path.join(dir, "features/a.feature"), "Feature: a, changed\n");
		expect(outcomeAgainst(v() as never), "a change to what the features depend on is a state no run has run against").toBeUndefined();
	});

	it("records a failure as a run against the state too, which is what refuses an agent a second run over unchanged features", () => {
		const { dir, config } = aGroup();
		const v = verificationOf(conditions(dir, config)) as never;
		recordOutcome(v, "failed", 1);
		expect(outcomeAgainst(v)).toEqual({ outcome: "failed", features: 1 });
	});

	it("keeps a run per way of running the group: other options, another filter, a policy or added steppers are another run", () => {
		const { dir, config } = aGroup();
		const plain = verificationOf(conditions(dir, config)) as never;
		const onAnotherPort = verificationOf(conditions(dir, config, { moduleOptions: { WEBSERVER_PORT: "8300" } })) as never;
		const narrowed = verificationOf(conditions(dir, config, { filter: ["a"] })) as never;
		const underPolicy = verificationOf(conditions(dir, config, { policy: { place: "local", dirFilters: [{ dir: "smoke", access: "r" }] } as never })) as never;
		const withMore = verificationOf(conditions(dir, config, { withSteppers: ["debugger-stepper"] })) as never;
		recordOutcome(plain, "passed", 1);
		for (const other of [onAnotherPort, narrowed, underPolicy, withMore]) expect(outcomeAgainst(other)).toBeUndefined();
		expect(outcomeAgainst(plain)).toEqual({ outcome: "passed", features: 1 });
	});

	it("does not tell runs apart by what varies per run without changing what runs", () => {
		const c = (options: Record<string, unknown>) => runConditions({ configPath: "c.json", specl, bases: ["."], cwd: ".", filter: [], options, moduleOptions: {} });
		expect(c({ KEY: "1", DESCRIPTION: "x", STAY: "always", DEST: "d" })).toBe(c({ KEY: "2", DEST: "d" }));
		expect(c({ DEST: "d" })).not.toBe(c({ DEST: "e" }));
	});

	it("forgets the runs of the features named, and the runs of the whole group that include them, and no other", () => {
		const { dir, config } = aGroup();
		const whole = verificationOf(conditions(dir, config)) as never;
		const a = verificationOf(conditions(dir, config, { filter: ["a"] })) as never;
		const b = verificationOf(conditions(dir, config, { filter: ["b"] })) as never;
		for (const v of [whole, a, b]) recordOutcome(v, "passed", 1);
		forgetOutcomes(dir, "a");
		expect(outcomeAgainst(a)).toBeUndefined();
		expect(outcomeAgainst(whole), "the whole group includes a").toBeUndefined();
		expect(outcomeAgainst(b), "b was not named").toEqual({ outcome: "passed", features: 1 });
	});

	it("forgets a run that did not reach its features, and every run when a change is noted", () => {
		const { dir, config } = aGroup();
		const v = verificationOf(conditions(dir, config)) as never;
		recordOutcome(v, "passed", 1);
		forgetOutcome(v);
		expect(outcomeAgainst(v), "a run that could not start says nothing about the state").toBeUndefined();
		recordOutcome(v, "passed", 1);
		forgetOutcomes(dir);
		expect(outcomeAgainst(v)).toBeUndefined();
	});

	it("verifies a group kept in no repository against nothing", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-norepo-"));
		nodeFS.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ steppers: [] }));
		expect(verificationOf(conditions(dir, path.join(dir, "config.json")))).toBeUndefined();
	});
});
