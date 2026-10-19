// Tests the actualities file: a group's last actuality against the state of its dependencies, and how long each feature took.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACTUALITIES_FILE } from "@haibun/core/lib/adapters/dependency-state.js";
import { RECORDED_STATUS } from "@haibun/core/lib/domains/protocol.js";
import { forgetOutcome, forgetOutcomes, machineKey, outcomeAgainst, recordActuality, actualityConditions, varianceLine, verificationOf } from "./actualities.js";

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
const verified = (dir: string, config: string, more: Partial<Parameters<typeof verificationOf>[0]> = {}) => {
	const v = verificationOf(conditions(dir, config, more));
	if (!v) throw new Error(`${dir} doesn't have a readable state`);
	return v;
};

/** A level's record as moveActuality writes it, begun at 0 and ended after `ms`. */
const level = (actualityLevel: string, id: string, stepText: string, status: string, ms: number, featurePath?: string) => ({
	id,
	stepText,
	actionStatus: status,
	accessLevel: "private",
	level: "info",
	actualityLevel,
	generatedAtTime: new Date(0).toISOString(),
	endedAtTime: new Date(ms).toISOString(),
	...(featurePath ? { path: featurePath } : {}),
});
/** An actuality of features, each by its path and how long it took, with its result and the records of its levels. */
function anActuality(status: string, features: Record<string, number>, declared = "declared") {
	const levels = new Map<string, Record<string, unknown>>([["execution", level("execution", "1-0", "tests", status, 9000)]]);
	const featureResults = Object.entries(features).map(([featurePath, ms], at) => {
		levels.set(`feat-${at + 1}`, level("feature", `1-${at + 1}.0.${at + 1}.0`, featurePath, status, ms, featurePath));
		return { path: featurePath, ok: true, steps: { count: 2 }, declaredStepTextHash: `${declared} ${featurePath}`, stepResults: [], pending: [] };
	});
	return { result: { ok: status === RECORDED_STATUS.completed, featureResults } as never, levels };
}
const actualitiesIn = (dir: string) => JSON.parse(nodeFS.readFileSync(path.join(dir, ACTUALITIES_FILE), "utf-8"));

describe("how a group last ran against its state", () => {
	it("doesn't return an actuality until one is recorded, returns it while the state is unchanged, and doesn't return it after a dependency changes", () => {
		const { dir, config } = aGroup();
		expect(outcomeAgainst(verified(dir, config))).toBeUndefined();
		const { result, levels } = anActuality(RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
		recordActuality(verified(dir, config), result, levels);
		expect(outcomeAgainst(verified(dir, config))).toBe(RECORDED_STATUS.completed);
		nodeFS.writeFileSync(path.join(dir, "features/a.feature"), "Feature: a, changed\n");
		expect(outcomeAgainst(verified(dir, config)), "a changed dependency is a new state, and the file doesn't hold an actuality against it").toBeUndefined();
	});

	it("records a failure as an actuality against the state, so InstanceStepper refuses a second run over unchanged features", () => {
		const { dir, config } = aGroup();
		const { result, levels } = anActuality(RECORDED_STATUS.failed, { "/features/a.feature": 1000 });
		recordActuality(verified(dir, config), result, levels);
		expect(outcomeAgainst(verified(dir, config))).toBe(RECORDED_STATUS.failed);
	});

	it("keeps a separate actuality for each way of running the group: other module options, another filter, a policy or added steppers each key a separate actuality", () => {
		const { dir, config } = aGroup();
		const plain = verified(dir, config);
		const others = [
			{ moduleOptions: { WEBSERVER_PORT: "8300" } },
			{ filter: ["a"] },
			{ policy: { place: "local", dirFilters: [{ dir: "smoke", access: "r" }] } as never },
			{ withSteppers: ["debugger-stepper"] },
		];
		const { result, levels } = anActuality(RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
		recordActuality(plain, result, levels);
		for (const other of others) expect(outcomeAgainst(verified(dir, config, other))).toBeUndefined();
		expect(outcomeAgainst(plain)).toBe(RECORDED_STATUS.completed);
	});

	it("gives one key to actualities that differ only in options that don't change what runs", () => {
		const c = (options: Record<string, unknown>) => actualityConditions({ configPath: "c.json", specl, bases: ["."], cwd: ".", filter: [], options, moduleOptions: {} });
		expect(c({ KEY: "1", STAY: "always", DEST: "d" })).toBe(c({ KEY: "2", DEST: "d" }));
		expect(c({ DEST: "d" })).not.toBe(c({ DEST: "e" }));
	});

	it("clears the actualities of the named features and of the whole group that includes them, and an actuality that didn't reach its features, and keeps their durations", () => {
		const { dir, config } = aGroup();
		const [whole, a, b] = [verified(dir, config), verified(dir, config, { filter: ["a"] }), verified(dir, config, { filter: ["b"] })];
		const { result, levels } = anActuality(RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
		for (const v of [whole, a, b]) recordActuality(v, result, levels);
		forgetOutcomes(dir, "a");
		expect([outcomeAgainst(a), outcomeAgainst(whole), outcomeAgainst(b)], "the whole group includes a, and b wasn't named").toEqual([
			undefined,
			undefined,
			RECORDED_STATUS.completed,
		]);
		forgetOutcome(b);
		expect(outcomeAgainst(b), "an actuality that didn't reach its features isn't evidence about the state").toBeUndefined();
		expect(actualitiesIn(dir)[machineKey()][b.conditions].features["/features/a.feature"].tookMs).toBe(1000);
	});

	it("doesn't verify a group outside a git repository against a state", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-norepo-"));
		nodeFS.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ steppers: [] }));
		expect(verificationOf(conditions(dir, path.join(dir, "config.json")))).toBeUndefined();
	});
});

describe("how long a group's features took", () => {
	it("holds the lines of an actuality's execution and features under this machine, each duration in tenths of a second, with a feature's steps and the hash of its declared lines", () => {
		const { dir, config } = aGroup();
		const v = verified(dir, config);
		const { result, levels } = anActuality(RECORDED_STATUS.completed, { "/features/a.feature": 1234 });
		recordActuality(v, result, levels);
		expect(actualitiesIn(dir)[machineKey()][v.conditions]).toEqual({
			state: v.state,
			filter: "",
			execution: { text: ".", status: RECORDED_STATUS.completed, tookMs: 9000 },
			features: {
				"/features/a.feature": { text: "/features/a.feature", status: RECORDED_STATUS.completed, tookMs: 1200, steps: 2, declaredStepTextHash: "declared /features/a.feature" },
			},
		});
	});

	it("is the same file for the same group checked out at another directory, its paths relative to the repository's top", () => {
		const [one, other] = [aGroup(), aGroup()];
		const [first, second] = [verified(one.dir, one.config), verified(other.dir, other.config, { cwd: path.dirname(other.dir), bases: [path.basename(other.dir)] })];
		for (const v of [first, second]) {
			const { result, levels } = anActuality(RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
			recordActuality(v, result, levels);
		}
		expect(nodeFS.readFileSync(path.join(other.dir, ACTUALITIES_FILE), "utf-8")).toBe(nodeFS.readFileSync(path.join(one.dir, ACTUALITIES_FILE), "utf-8"));
	});

	it("reports a feature whose duration differs from this machine's last actuality by both a fifth and a second, and whether its declared steps changed", () => {
		const { dir, config } = aGroup();
		const first = anActuality(RECORDED_STATUS.completed, { "/a.feature": 10_000, "/b.feature": 10_000, "/c.feature": 500 });
		expect(recordActuality(verified(dir, config), first.result, first.levels), "a machine without a recorded actuality doesn't have times to compare").toEqual([]);
		const second = anActuality(RECORDED_STATUS.completed, { "/a.feature": 20_000, "/b.feature": 11_000, "/c.feature": 1200, "/d.feature": 9000 }, "changed");
		expect(
			recordActuality(verified(dir, config), second.result, second.levels).map((variance) => [variance.feature, variance.was, variance.seconds, variance.declaredStepsChanged]),
			"/b differs by less than a fifth, /c by less than a second, and /d wasn't in the last actuality",
		).toEqual([["/a.feature", 10, 20, true]]);
	});

	it("names the class of machine by its processor, core count, architecture and platform, and doesn't include the host name", () => {
		const key = machineKey();
		expect([key.includes(os.platform()), key.includes(os.arch()), key.includes(`${os.cpus().length}x`), key.includes(os.hostname().toLowerCase())]).toEqual([
			true,
			true,
			true,
			false,
		]);
	});

	it("formats the feature, both durations, the percentage change, the step counts and a change to the declared steps", () => {
		expect(varianceLine({ feature: "/a.feature", seconds: 20, was: 10, steps: 7, wasSteps: 5, declaredStepsChanged: true })).toBe(
			"/a.feature took 20s, was 10s (+100%), 7 steps, was 5, its declared steps changed",
		);
		expect(varianceLine({ feature: "/a.feature", seconds: 5, was: 10, steps: 5, wasSteps: 5, declaredStepsChanged: false })).toBe("/a.feature took 5s, was 10s (-50%), 5 steps");
	});

	it("refuses an actualities file that doesn't hold actualities by machine and conditions, since replacing it would lose them", () => {
		const { dir, config } = aGroup();
		nodeFS.writeFileSync(path.join(dir, ACTUALITIES_FILE), JSON.stringify({ [machineKey()]: { features: {} } }));
		const { result, levels } = anActuality(RECORDED_STATUS.completed, { "/a.feature": 100 });
		expect(() => recordActuality(verified(dir, config), result, levels)).toThrow("doesn't hold actualities by machine and conditions");
	});
});
