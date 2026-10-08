// Tests the per-feature timings a run writes to the file committed with the code.
import { describe, it, expect } from "vitest";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { TIMINGS_FILE, machineKey, recordTimings, timingsOf, varianceLine, variancesBetween, type TTimings } from "./timings.js";

/** Builds a feature result: its step summary and the hash of the text of the steps it declares. */
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

describe("a run's timings", () => {
	it("reports each feature's duration from its first step's start to its last step's end in tenths of a second, with its step count and declared step text hash", () => {
		expect(timingsOf(result)).toEqual({
			features: { "/features/quick.feature": timing(0.1, 2, "declared /features/quick.feature"), "/features/slow.feature": timing(2.3, 1, "declared /features/slow.feature") },
			steps: 3,
			seconds: 2.4,
		});
	});

	it("counts every step of a long feature whose result holds only its most recent steps", () => {
		expect(timingsOf(runOf(featureRan("/features/long.feature", 0, 90_000, 1500))).features["/features/long.feature"]).toEqual(timing(90, 1500, "declared /features/long.feature"));
	});

	it("writes a whole run's timings beside the configuration under this machine's key and replaces that machine's last entry", () => {
		const dir = tempDir("haibun-timings-");
		recordTimings(dir, result, false);
		recordTimings(dir, runOf(featureRan("/features/quick.feature", 0, 100, 1)), false);
		expect(writtenIn(dir)).toEqual({ [machineKey()]: { features: { "/features/quick.feature": timing(0.1, 1, "declared /features/quick.feature") }, steps: 1, seconds: 0.1 } });
	});

	it("replaces the entries of a filtered run's features, keeps every other feature's entry, and sums the totals again", () => {
		const dir = tempDir("haibun-filtered-");
		recordTimings(dir, result, false);
		recordTimings(dir, runOf(featureRan("/features/quick.feature", 0, 900, 4, "declared again")), true);
		expect(writtenIn(dir)[machineKey()]).toEqual({
			features: { "/features/quick.feature": timing(0.9, 4, "declared again"), "/features/slow.feature": timing(2.3, 1, "declared /features/slow.feature") },
			steps: 5,
			seconds: 3.2,
		});
	});

	it("replaces an entry that doesn't parse against the timings schema, without comparing against it or keeping its features", () => {
		const dir = tempDir("haibun-earlier-form-");
		nodeFS.writeFileSync(
			path.join(dir, TIMINGS_FILE),
			JSON.stringify({ [machineKey()]: { features: { "/features/slow.feature": { seconds: 99, steps: 1 } }, steps: 1, seconds: 99 } }),
		);
		expect(recordTimings(dir, runOf(featureRan("/features/quick.feature", 0, 100, 1)), true)).toEqual([]);
		expect(Object.keys(writtenIn(dir)[machineKey()].features)).toEqual(["/features/quick.feature"]);
	});

	it("reports a feature whose duration differs from the recorded run by both a fifth and a second", () => {
		const recorded: TTimings = { features: { "/a.feature": timing(10, 5), "/b.feature": timing(10, 5), "/c.feature": timing(0.5, 1) }, steps: 11, seconds: 20.5 };
		const now: TTimings = { features: { "/a.feature": timing(20, 5), "/b.feature": timing(11, 5), "/c.feature": timing(1.2, 1) }, steps: 11, seconds: 32.2 };
		expect(
			variancesBetween(recorded, now).map((v) => v.feature),
			"/a.feature differs by at least a fifth and a second; /b.feature differs by a second and by less than a fifth; /c.feature differs by more than a fifth and by less than a second",
		).toEqual(["/a.feature"]);
	});

	it("reports whether the declared steps of a slower feature changed", () => {
		const recorded: TTimings = { features: { "/a.feature": timing(10, 5), "/b.feature": timing(10, 5) }, steps: 10, seconds: 20 };
		const now: TTimings = { features: { "/a.feature": timing(20, 5, "declared other steps"), "/b.feature": timing(20, 5) }, steps: 10, seconds: 40 };
		expect(variancesBetween(recorded, now).map((v) => [v.feature, v.declaredStepsChanged])).toEqual([
			["/a.feature", true],
			["/b.feature", false],
		]);
	});

	it("doesn't report a variance where a run wasn't recorded, and leaves out a feature that only one run holds", () => {
		const now: TTimings = { features: { "/a.feature": timing(20, 5) }, steps: 5, seconds: 20 };
		expect(variancesBetween(undefined, now)).toEqual([]);
		expect(variancesBetween({ features: { "/b.feature": timing(1, 1) }, steps: 1, seconds: 1 }, now)).toEqual([]);
	});

	it("formats the feature, both durations, the percentage change, the step counts and a change to the declared steps", () => {
		expect(varianceLine({ feature: "/a.feature", seconds: 20, was: 10, steps: 7, wasSteps: 5, declaredStepsChanged: true })).toBe(
			"/a.feature took 20s, was 10s (+100%), 7 steps, was 5, its declared steps changed",
		);
		expect(varianceLine({ feature: "/a.feature", seconds: 5, was: 10, steps: 5, wasSteps: 5, declaredStepsChanged: false })).toBe("/a.feature took 5s, was 10s (-50%), 5 steps");
	});

	it("compares a run against the last run recorded on this class of machine", () => {
		const dir = tempDir("haibun-variance-");
		expect(recordTimings(dir, result, false), "a machine without a recorded run doesn't have times to compare").toEqual([]);
		const changed = recordTimings(dir, runOf(featureRan("/features/slow.feature", 2000, 9000, 1)), false);
		expect(changed.map((v) => [v.feature, v.was, v.seconds])).toEqual([["/features/slow.feature", 2.3, 7]]);
		expect(writtenIn(dir)[machineKey()].features["/features/slow.feature"].seconds).toBe(7);
	});

	it("names the class of machine by its processor, core count, architecture and platform, and doesn't include the host name", () => {
		const key = machineKey();
		expect(key).toContain(os.platform());
		expect(key).toContain(os.arch());
		expect(key).toContain(`${os.cpus().length}x`);
		expect(key).not.toContain(os.hostname().toLowerCase());
		expect(key).toMatch(/^[a-z0-9-]+$/);
	});

	it("keeps another machine's entry unchanged and doesn't compare against it", () => {
		const dir = tempDir("haibun-machines-");
		const other = { features: { "/features/slow.feature": timing(99, 1) }, steps: 1, seconds: 99 };
		nodeFS.writeFileSync(path.join(dir, TIMINGS_FILE), JSON.stringify({ "linux-x64-8x-another-processor": other }));
		expect(recordTimings(dir, result, false), "another machine's times don't apply to this machine").toEqual([]);
		expect(writtenIn(dir)["linux-x64-8x-another-processor"]).toEqual(other);
		expect(writtenIn(dir)[machineKey()].features["/features/slow.feature"].seconds).toBe(2.3);
	});
});
