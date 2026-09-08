// What a run took, feature by feature, as the file kept with the code says it.
import { describe, it, expect } from "vitest";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import os from "node:os";
import { TIMINGS_FILE, machineKey, recordTimings, timingsOf, varianceLine, variancesBetween } from "./timings.js";

const step = (start: number, end: number) => ({ ok: true, in: "a step", start, end, seqPath: [0], stepperName: "S", actionName: "a" });
const result = {
	ok: true,
	featureResults: [
		{ path: "/features/quick.feature", ok: true, stepResults: [step(1000, 1050), step(1050, 1130)] },
		{ path: "/features/slow.feature", ok: true, stepResults: [step(2000, 4250)] },
	],
} as never;

describe("what a run took", () => {
	it("says how long each feature took from its steps' own start and end, to a tenth of a second, with its step count", () => {
		expect(timingsOf(result)).toEqual({ features: { "/features/quick.feature": { seconds: 0.1, steps: 2 }, "/features/slow.feature": { seconds: 2.3, steps: 1 } }, steps: 3, seconds: 2.4 });
	});

	it("writes it beside the configuration under this machine's key, replacing what that machine last recorded", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-timings-"));
		recordTimings(dir, result);
		recordTimings(dir, { ok: true, featureResults: [{ path: "/features/quick.feature", ok: true, stepResults: [step(0, 100)] }] } as never);
		const written = JSON.parse(nodeFS.readFileSync(path.join(dir, TIMINGS_FILE), "utf-8"));
		expect(written).toEqual({ [machineKey()]: { features: { "/features/quick.feature": { seconds: 0.1, steps: 1 } }, steps: 1, seconds: 0.1 } });
	});

	it("reports a feature whose duration differs from the recorded run, by both a fifth and a second", () => {
		const recorded = { features: { "/a.feature": { seconds: 10, steps: 5 }, "/b.feature": { seconds: 10, steps: 5 }, "/c.feature": { seconds: 0.5, steps: 1 } }, steps: 11, seconds: 20.5 };
		const now = { features: { "/a.feature": { seconds: 20, steps: 5 }, "/b.feature": { seconds: 11, steps: 5 }, "/c.feature": { seconds: 1.2, steps: 1 } }, steps: 11, seconds: 32.2 };
		const changed = variancesBetween(recorded, now);
		expect(changed.map((v) => v.feature), "a fifth longer and a second longer; eleven against ten is neither, and a short feature is under the second").toEqual(["/a.feature"]);
	});

	it("reports nothing where no run was recorded, and leaves out a feature only one run holds", () => {
		const now = { features: { "/a.feature": { seconds: 20, steps: 5 } }, steps: 5, seconds: 20 };
		expect(variancesBetween(undefined, now)).toEqual([]);
		expect(variancesBetween({ features: { "/b.feature": { seconds: 1, steps: 1 } }, steps: 1, seconds: 1 }, now)).toEqual([]);
	});

	it("names the feature, both durations, the change and the step counts", () => {
		expect(varianceLine({ feature: "/a.feature", seconds: 20, was: 10, steps: 7, wasSteps: 5 })).toBe("/a.feature took 20s, was 10s (+100%), 7 steps, was 5");
		expect(varianceLine({ feature: "/a.feature", seconds: 5, was: 10, steps: 5, wasSteps: 5 })).toBe("/a.feature took 5s, was 10s (-50%), 5 steps");
	});

	it("compares the run against the last run on this class of machine", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-variance-"));
		expect(recordTimings(dir, result), "a machine with no recorded run has nothing to compare").toEqual([]);
		const slower = { ok: true, featureResults: [{ path: "/features/slow.feature", ok: true, stepResults: [step(2000, 9000)] }] } as never;
		const changed = recordTimings(dir, slower);
		expect(changed.map((v) => [v.feature, v.was, v.seconds])).toEqual([["/features/slow.feature", 2.3, 7]]);
		expect(JSON.parse(nodeFS.readFileSync(path.join(dir, TIMINGS_FILE), "utf-8"))[machineKey()].features["/features/slow.feature"].seconds).toBe(7);
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
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-machines-"));
		const other = { features: { "/features/slow.feature": { seconds: 99, steps: 1 } }, steps: 1, seconds: 99 };
		nodeFS.writeFileSync(path.join(dir, TIMINGS_FILE), JSON.stringify({ "linux-x64-8x-another-processor": other }));
		expect(recordTimings(dir, result), "the other machine's times are no measure of this one").toEqual([]);
		const written = JSON.parse(nodeFS.readFileSync(path.join(dir, TIMINGS_FILE), "utf-8"));
		expect(written["linux-x64-8x-another-processor"]).toEqual(other);
		expect(written[machineKey()].features["/features/slow.feature"].seconds).toBe(2.3);
	});
});
