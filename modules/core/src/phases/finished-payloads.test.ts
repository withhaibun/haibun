/**
 * What a run keeps once a feature is over. A verdict names a failed step and quotes what it said; everything else a
 * reader follows through the event stream. Keeping every passing step's products as well means a long run holds every
 * graph slice, response body and rendered document it ever produced, which is how a nineteen-feature run exhausted the
 * heap and was killed rather than failing.
 */
import { describe, it, expect } from "vitest";
import { releasePayloads } from "./Executor.js";
import type { TFeatureResult, TStepResult } from "../schema/protocol.js";

const step = (over: Partial<TStepResult>): TStepResult => ({
	name: "step",
	in: "a step",
	path: "/features/test.feature",
	seqPath: [0, 1, 1],
	ok: true,
	products: { big: "x".repeat(1000) },
	artifact: { type: "json", json: { big: true } } as TStepResult["artifact"],
	traces: [{ type: "request" } as unknown as NonNullable<TStepResult["traces"]>[number]],
	...over,
});

const finished = (steps: TStepResult[]): TFeatureResult => {
	const result: TFeatureResult = { path: "/features/test.feature", ok: steps.every((s) => s.ok), stepResults: steps };
	releasePayloads(result);
	return result;
};

describe("what a run keeps of a feature it has moved on from", () => {
	it("keeps a passing step, and lets go of what it produced", () => {
		const [kept] = finished([step({})]).stepResults;
		expect(kept.in, "the step is still there to be counted and read").toBe("a step");
		expect(kept.seqPath, "and still says where it ran").toEqual([0, 1, 1]);
		expect(kept.products, "but nothing holds its products").toBeUndefined();
		expect(kept.artifact).toBeUndefined();
		expect(kept.traces).toBeUndefined();
	});

	it("keeps everything a failed step carried, since that is what the verdict is made of", () => {
		const failed = step({ ok: false, errorMessage: "it refused" });
		const [kept] = finished([failed]).stepResults;
		expect(kept.errorMessage).toBe("it refused");
		expect(kept.products, "a failure is read in full").toEqual(failed.products);
		expect(kept.artifact).toEqual(failed.artifact);
	});

	it("leaves the feature's own verdict alone", () => {
		const result = finished([step({}), step({ ok: false, errorMessage: "no" })]);
		expect(result.ok).toBe(false);
		expect(result.stepResults.length).toBe(2);
	});
});
