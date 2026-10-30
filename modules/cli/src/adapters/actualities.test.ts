// Tests the actualities file: a group's last actuality against the state of its dependencies, and how long each feature took.
import { testTempDir } from "@haibun/core/lib/test/temp-dir.js";
import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACTUALITIES_FILE } from "@haibun/core/lib/adapters/dependency-state.js";
import { RECORDED_STATUS } from "@haibun/core/lib/domains/protocol.js";
import { digestFields } from "@haibun/core/lib/domains/digest.js";
import { forgetOutcome, forgetOutcomes, machineKey, outcomeAgainst, recordActuality, actualityConditions, verificationOf } from "./actualities.js";

/** Creates a group of features and a library in its own git repository. The group doesn't load steppers, so its only
 *  dependency is its own directory, or its features and its library where it names them as two roots. */
function aGroup(): { dir: string; config: string } {
	const dir = testTempDir("haibun-verified-");
	execFileSync("git", ["init", "-q"], { cwd: dir });
	nodeFS.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ steppers: [] }));
	for (const dependency of ["features", "lib"]) nodeFS.mkdirSync(path.join(dir, dependency));
	nodeFS.writeFileSync(path.join(dir, "features/a.feature"), "Feature: a\n");
	nodeFS.writeFileSync(path.join(dir, "lib/a.ts"), "export {};\n");
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
const verified = async (dir: string, config: string, more: Partial<Parameters<typeof verificationOf>[0]> = {}) => {
	const v = await verificationOf(conditions(dir, config, more));
	if (!v) throw new Error(`${dir} doesn't have a readable state`);
	return v;
};

/** A level's record as moveActuality writes it, begun at 0 and ended after `ms`. */
const level = (actualityLevel: string, id: string, stepText: string, status: string, ms: number, stated: Record<string, unknown> = {}) => ({
	id,
	stepText,
	actionStatus: status,
	accessLevel: "private",
	level: "info",
	actualityLevel,
	generatedAtTime: new Date(0).toISOString(),
	endedAtTime: new Date(ms).toISOString(),
	...stated,
});
/** Records an actuality of features, each by its path and how long it took, whose own record states the digests `v` read. */
function recordFeatures(v: Awaited<ReturnType<typeof verified>>, status: string, features: Record<string, number>) {
	const levels = new Map<string, Record<string, unknown>>([["actuality", level("actuality", "1-0", "tests", status, 9000, digestFields(v.digest))]]);
	const featureResults = Object.entries(features).map(([featurePath, ms], at) => {
		levels.set(`feat-${at + 1}`, level("feature", `1-${at + 1}.0.${at + 1}.0`, featurePath, status, ms, { path: featurePath }));
		return { path: featurePath, ok: true, steps: { count: 2 }, stepResults: [], pending: [] };
	});
	return recordActuality(v, { ok: status === RECORDED_STATUS.completed, featureResults } as never, levels);
}
const actualitiesIn = (dir: string) => JSON.parse(nodeFS.readFileSync(path.join(dir, ACTUALITIES_FILE), "utf-8"));

describe("how a group last ran against its state", () => {
	it("doesn't return an actuality until one is recorded, returns it while every dependency holds its digest, and doesn't return it once any changes", async () => {
		const { dir, config } = aGroup();
		const twoRoots = { specl: { steppers: [], dependsOn: ["lib"] }, bases: [path.join(dir, "features")] };
		const before = await verified(dir, config, twoRoots);
		expect(outcomeAgainst(before)).toBeUndefined();
		recordFeatures(before, RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
		expect(outcomeAgainst(await verified(dir, config, twoRoots)), "every dependency holds the digest it held, so --once skips the group").toBe(RECORDED_STATUS.completed);
		nodeFS.appendFileSync(path.join(dir, "lib/a.ts"), "// changed\n");
		const now = await verified(dir, config, twoRoots);
		expect(now.digest.features, "the features hold their digest").toBe(before.digest.features);
		expect(outcomeAgainst(now), "a change to the library alone reruns the group").toBeUndefined();
	});

	it("records a failure as an actuality against the state, so InstanceStepper refuses a second run over unchanged features", async () => {
		const { dir, config } = aGroup();
		recordFeatures(await verified(dir, config), RECORDED_STATUS.failed, { "/features/a.feature": 1000 });
		expect(outcomeAgainst(await verified(dir, config))).toBe(RECORDED_STATUS.failed);
	});

	it("keeps a separate actuality for each way of running the group: other module options, another filter, a policy or added steppers each key a separate actuality", async () => {
		const { dir, config } = aGroup();
		const plain = await verified(dir, config);
		const others = [
			{ moduleOptions: { WEBSERVER_PORT: "8300" } },
			{ filter: ["a"] },
			{ policy: { place: "local", dirFilters: [{ dir: "smoke", access: "r" }] } as never },
			{ withSteppers: ["debugger-stepper"] },
		];
		recordFeatures(plain, RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
		for (const other of others) expect(outcomeAgainst(await verified(dir, config, other))).toBeUndefined();
		expect(outcomeAgainst(plain)).toBe(RECORDED_STATUS.completed);
	});

	it("gives one key to actualities that differ only in options that don't change what runs", () => {
		const c = (options: Record<string, unknown>) => actualityConditions({ configPath: "c.json", specl, bases: ["."], cwd: ".", filter: [], options, moduleOptions: {} });
		expect(c({ KEY: "1", STAY: "always", ONCE: true, DEST: "d" })).toBe(c({ KEY: "2", DEST: "d" }));
		expect(c({ DEST: "d" })).not.toBe(c({ DEST: "e" }));
	});

	it("clears the actualities of the named features and of the whole group that includes them, and an actuality that didn't reach its features, and keeps their durations", async () => {
		const { dir, config } = aGroup();
		const [whole, a, b] = [await verified(dir, config), await verified(dir, config, { filter: ["a"] }), await verified(dir, config, { filter: ["b"] })];
		for (const v of [whole, a, b]) recordFeatures(v, RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
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

	it("doesn't verify a group outside a git repository against a state", async () => {
		const dir = testTempDir("haibun-norepo-");
		nodeFS.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ steppers: [] }));
		expect(await verificationOf(conditions(dir, path.join(dir, "config.json")))).toBeUndefined();
	});
});

describe("how long a group's features took", () => {
	it("holds the lines of an actuality's own record with its digests and of its features with their steps under this machine, each duration in tenths of a second", async () => {
		const { dir, config } = aGroup();
		const v = await verified(dir, config);
		recordFeatures(v, RECORDED_STATUS.completed, { "/features/a.feature": 1234 });
		expect(actualitiesIn(dir)[machineKey()][v.conditions]).toEqual({
			filter: "",
			actuality: { text: ".", status: RECORDED_STATUS.completed, tookMs: 9000, digest: v.digest },
			features: { "/features/a.feature": { text: "/features/a.feature", status: RECORDED_STATUS.completed, tookMs: 1200, steps: 2 } },
		});
	});

	it("is the same file for the same group checked out at another directory, its paths relative to the repository's top", async () => {
		const [one, other] = [aGroup(), aGroup()];
		const [first, second] = [await verified(one.dir, one.config), await verified(other.dir, other.config, { cwd: path.dirname(other.dir), bases: [path.basename(other.dir)] })];
		for (const v of [first, second]) recordFeatures(v, RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
		expect(nodeFS.readFileSync(path.join(other.dir, ACTUALITIES_FILE), "utf-8")).toBe(nodeFS.readFileSync(path.join(one.dir, ACTUALITIES_FILE), "utf-8"));
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

	it("is read whole while it is written, and a write that stops partway leaves it as it was", async () => {
		// Runs of one group read and write the file at once, and a run that read it while another wrote it read it half written.
		const { dir, config } = aGroup();
		const v = await verified(dir, config);
		recordFeatures(v, RECORDED_STATUS.completed, { "/features/a.feature": 1000 });
		const before = nodeFS.readFileSync(path.join(dir, ACTUALITIES_FILE), "utf-8");
		const write = nodeFS.writeFileSync;
		const stopped = vi.spyOn(nodeFS, "writeFileSync").mockImplementation((file, contents) => {
			write(file, String(contents).slice(0, 10));
			throw new Error("the write stopped partway");
		});
		expect(() => recordFeatures(v, RECORDED_STATUS.failed, { "/features/a.feature": 2000 })).toThrow("the write stopped partway");
		stopped.mockRestore();
		expect(nodeFS.readFileSync(path.join(dir, ACTUALITIES_FILE), "utf-8")).toBe(before);
	});

	it("refuses an actualities file that doesn't hold actualities by machine and conditions, since replacing it would lose them", async () => {
		const { dir, config } = aGroup();
		nodeFS.writeFileSync(path.join(dir, ACTUALITIES_FILE), JSON.stringify({ [machineKey()]: { features: {} } }));
		const v = await verified(dir, config);
		expect(() => recordFeatures(v, RECORDED_STATUS.completed, { "/a.feature": 100 })).toThrow("doesn't hold actualities by machine and conditions");
	});
});
