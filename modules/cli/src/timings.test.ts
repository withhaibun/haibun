// What a run took, feature by feature, as the file kept with the code says it.
import { describe, it, expect } from "vitest";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { TIMINGS_FILE, machineKey, recordTimings, timingsOf, varianceLine, variancesBetween, type TTimings } from "./timings.js";

/** A feature as a run reports it: what its steps came to, and the hash of the text of the steps it declares. */
const featureRan = (featurePath: string, firstStart: number, lastEnd: number, count: number, declaredStepTextHash = `declared ${featurePath}`) => ({
	path: featurePath,
	ok: true,
	steps: { count, firstStart, lastEnd },
	declaredStepTextHash,
	stepResults: [],
});
const runOf = (...features: ReturnType<typeof featureRan>[]) => ({ ok: true, featureResults: features }) as never;
const result = runOf(featureRan("/features/quick.feature", 1000, 1130, 2), featureRan("/features/slow.feature", 2000, 4250, 1));
const tempDir = (prefix: string) => nodeFS.mkdtempSync(path.join(os.tmpdir(), prefix));
const writtenIn = (dir: string) => JSON.parse(nodeFS.readFileSync(path.join(dir, TIMINGS_FILE), "utf-8"));
const timing = (seconds: number, steps: number, declaredStepTextHash = "declared") => ({ seconds, steps, declaredStepTextHash });

describe("what a run took", () => {
	it("says how long each feature took from its first step's start to its last step's end, to a tenth of a second, with its steps and declared step text hash", () => {
		expect(timingsOf(result)).toEqual({
			features: { "/features/quick.feature": timing(0.1, 2, "declared /features/quick.feature"), "/features/slow.feature": timing(2.3, 1, "declared /features/slow.feature") },
			steps: 3,
			seconds: 2.4,
		});
	});

	it("counts every step a long feature ran, though its result holds only the most recent of them", () => {
		expect(timingsOf(runOf(featureRan("/features/long.feature", 0, 90_000, 1500))).features["/features/long.feature"]).toEqual(timing(90, 1500, "declared /features/long.feature"));
	});

	it("writes a whole run beside the configuration under this machine's key, replacing what that machine last recorded", () => {
		const dir = tempDir("haibun-timings-");
		recordTimings(dir, result, false);
		recordTimings(dir, runOf(featureRan("/features/quick.feature", 0, 100, 1)), false);
		expect(writtenIn(dir)).toEqual({ [machineKey()]: { features: { "/features/quick.feature": timing(0.1, 1, "declared /features/quick.feature") }, steps: 1, seconds: 0.1 } });
	});

	it("writes a filtered run's features over their own entries and keeps every other feature as recorded, with the whole summed again", () => {
		const dir = tempDir("haibun-filtered-");
		recordTimings(dir, result, false);
		recordTimings(dir, runOf(featureRan("/features/quick.feature", 0, 900, 4, "declared again")), true);
		expect(writtenIn(dir)[machineKey()]).toEqual({
			features: { "/features/quick.feature": timing(0.9, 4, "declared again"), "/features/slow.feature": timing(2.3, 1, "declared /features/slow.feature") },
			steps: 5,
			seconds: 3.2,
		});
	});

	it("replaces an entry recorded in another form, rather than comparing against it or keeping its features", () => {
		const dir = tempDir("haibun-earlier-form-");
		nodeFS.writeFileSync(
			path.join(dir, TIMINGS_FILE),
			JSON.stringify({ [machineKey()]: { features: { "/features/slow.feature": { seconds: 99, steps: 1 } }, steps: 1, seconds: 99 } }),
		);
		expect(recordTimings(dir, runOf(featureRan("/features/quick.feature", 0, 100, 1)), true)).toEqual([]);
		expect(Object.keys(writtenIn(dir)[machineKey()].features)).toEqual(["/features/quick.feature"]);
	});

	it("reports a feature whose duration differs from the recorded run, by both a fifth and a second", () => {
		const recorded: TTimings = { features: { "/a.feature": timing(10, 5), "/b.feature": timing(10, 5), "/c.feature": timing(0.5, 1) }, steps: 11, seconds: 20.5 };
		const now: TTimings = { features: { "/a.feature": timing(20, 5), "/b.feature": timing(11, 5), "/c.feature": timing(1.2, 1) }, steps: 11, seconds: 32.2 };
		expect(
			variancesBetween(recorded, now).map((v) => v.feature),
			"a fifth longer and a second longer; eleven against ten is neither, and a short feature is under the second",
		).toEqual(["/a.feature"]);
	});

	it("says whether a feature that took longer declares other steps than it did", () => {
		const recorded: TTimings = { features: { "/a.feature": timing(10, 5), "/b.feature": timing(10, 5) }, steps: 10, seconds: 20 };
		const now: TTimings = { features: { "/a.feature": timing(20, 5, "declared other steps"), "/b.feature": timing(20, 5) }, steps: 10, seconds: 40 };
		expect(variancesBetween(recorded, now).map((v) => [v.feature, v.declaredStepsChanged])).toEqual([
			["/a.feature", true],
			["/b.feature", false],
		]);
	});

	it("reports nothing where no run was recorded, and leaves out a feature only one run holds", () => {
		const now: TTimings = { features: { "/a.feature": timing(20, 5) }, steps: 5, seconds: 20 };
		expect(variancesBetween(undefined, now)).toEqual([]);
		expect(variancesBetween({ features: { "/b.feature": timing(1, 1) }, steps: 1, seconds: 1 }, now)).toEqual([]);
	});

	it("names the feature, both durations, the change, the step counts, and declared steps that changed", () => {
		expect(varianceLine({ feature: "/a.feature", seconds: 20, was: 10, steps: 7, wasSteps: 5, declaredStepsChanged: true })).toBe(
			"/a.feature took 20s, was 10s (+100%), 7 steps, was 5, its declared steps changed",
		);
		expect(varianceLine({ feature: "/a.feature", seconds: 5, was: 10, steps: 5, wasSteps: 5, declaredStepsChanged: false })).toBe("/a.feature took 5s, was 10s (-50%), 5 steps");
	});

	it("compares the run against the last run on this class of machine", () => {
		const dir = tempDir("haibun-variance-");
		expect(recordTimings(dir, result, false), "a machine with no recorded run has nothing to compare").toEqual([]);
		const changed = recordTimings(dir, runOf(featureRan("/features/slow.feature", 2000, 9000, 1)), false);
		expect(changed.map((v) => [v.feature, v.was, v.seconds])).toEqual([["/features/slow.feature", 2.3, 7]]);
		expect(writtenIn(dir)[machineKey()].features["/features/slow.feature"].seconds).toBe(7);
	});

	it("names the class of machine by its processor, cores, architecture and platform, and by nothing that identifies the host", () => {
		const key = machineKey();
		expect(key).toContain(os.platform());
		expect(key).toContain(os.arch());
		expect(key).toContain(`${os.cpus().length}x`);
		expect(key).not.toContain(os.hostname().toLowerCase());
		expect(key).toMatch(/^[a-z0-9-]+$/);
	});

	it("leaves another machine's times as that machine measured them, and does not compare against them", () => {
		const dir = tempDir("haibun-machines-");
		const other = { features: { "/features/slow.feature": timing(99, 1) }, steps: 1, seconds: 99 };
		nodeFS.writeFileSync(path.join(dir, TIMINGS_FILE), JSON.stringify({ "linux-x64-8x-another-processor": other }));
		expect(recordTimings(dir, result, false), "the other machine's times are no measure of this one").toEqual([]);
		expect(writtenIn(dir)["linux-x64-8x-another-processor"]).toEqual(other);
		expect(writtenIn(dir)[machineKey()].features["/features/slow.feature"].seconds).toBe(2.3);
	});
});
