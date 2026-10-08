// Tests the record of a group's runs against the state of its dependencies. A caller reads the record to determine
// whether the group runs again.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { forgetOutcome, forgetOutcomes, outcomeAgainst, recordOutcome, runConditions, verificationOf } from "./verified.js";

/** Creates a group of features in its own git repository. The group doesn't load steppers, so its only dependency is
 *  its own directory. */
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
	it("doesn't return a run until one is recorded, returns it while the state is unchanged, and doesn't return it after a dependency changes", () => {
		const { dir, config } = aGroup();
		const v = () => verificationOf(conditions(dir, config));
		expect(outcomeAgainst(v() as never)).toBeUndefined();
		recordOutcome(v() as never, "passed", 1);
		expect(outcomeAgainst(v() as never)).toEqual({ outcome: "passed", features: 1 });
		nodeFS.writeFileSync(path.join(dir, "features/a.feature"), "Feature: a, changed\n");
		expect(outcomeAgainst(v() as never), "a changed dependency is a new state, and the record doesn't hold a run against it").toBeUndefined();
	});

	it("records a failure as a run against the state, so InstanceStepper refuses a second run over unchanged features", () => {
		const { dir, config } = aGroup();
		const v = verificationOf(conditions(dir, config)) as never;
		recordOutcome(v, "failed", 1);
		expect(outcomeAgainst(v)).toEqual({ outcome: "failed", features: 1 });
	});

	it("keeps a separate run for each way of running the group: other module options, another filter, a policy or added steppers each key a separate run", () => {
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

	it("gives one key to runs that differ only in options that don't change what runs", () => {
		const c = (options: Record<string, unknown>) => runConditions({ configPath: "c.json", specl, bases: ["."], cwd: ".", filter: [], options, moduleOptions: {} });
		expect(c({ KEY: "1", DESCRIPTION: "x", STAY: "always", DEST: "d" })).toBe(c({ KEY: "2", DEST: "d" }));
		expect(c({ DEST: "d" })).not.toBe(c({ DEST: "e" }));
	});

	it("deletes the runs of the named features and the runs of the whole group that include them, and keeps every other run", () => {
		const { dir, config } = aGroup();
		const whole = verificationOf(conditions(dir, config)) as never;
		const a = verificationOf(conditions(dir, config, { filter: ["a"] })) as never;
		const b = verificationOf(conditions(dir, config, { filter: ["b"] })) as never;
		for (const v of [whole, a, b]) recordOutcome(v, "passed", 1);
		forgetOutcomes(dir, "a");
		expect(outcomeAgainst(a)).toBeUndefined();
		expect(outcomeAgainst(whole), "the whole group includes a").toBeUndefined();
		expect(outcomeAgainst(b), "b wasn't named").toEqual({ outcome: "passed", features: 1 });
	});

	it("deletes a run that didn't reach its features, and deletes every run when a change is noted", () => {
		const { dir, config } = aGroup();
		const v = verificationOf(conditions(dir, config)) as never;
		recordOutcome(v, "passed", 1);
		forgetOutcome(v);
		expect(outcomeAgainst(v), "a run that didn't reach its features isn't evidence about the state").toBeUndefined();
		recordOutcome(v, "passed", 1);
		forgetOutcomes(dir);
		expect(outcomeAgainst(v)).toBeUndefined();
	});

	it("doesn't verify a group outside a git repository against a state", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-norepo-"));
		nodeFS.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ steppers: [] }));
		expect(verificationOf(conditions(dir, path.join(dir, "config.json")))).toBeUndefined();
	});
});
