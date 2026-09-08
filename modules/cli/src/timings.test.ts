// What a run took, feature by feature, as the file kept with the code says it.
import { describe, it, expect } from "vitest";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { TIMINGS_FILE, recordTimings, timingsOf } from "./timings.js";

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

	it("writes it beside the configuration, replacing the last run's, so the file's history is the history of what the features cost", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-timings-"));
		recordTimings(dir, result);
		recordTimings(dir, { ok: true, featureResults: [{ path: "/features/quick.feature", ok: true, stepResults: [step(0, 100)] }] } as never);
		const written = JSON.parse(nodeFS.readFileSync(path.join(dir, TIMINGS_FILE), "utf-8"));
		expect(written).toEqual({ features: { "/features/quick.feature": { seconds: 0.1, steps: 1 } }, steps: 1, seconds: 0.1 });
	});
});
