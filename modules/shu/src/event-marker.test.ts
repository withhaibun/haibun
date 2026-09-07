/**
 * What a mark on a rail or a slider says, which must be what the log says.
 *
 * A rail that chooses its own glyph announces a failure the log does not: a passing run showed two red failure marks,
 * for a call it handed out and a statement it merely tried.
 */
import { describe, expect, it } from "vitest";
import { CHECK_NO, ICON_STEP_COMPLETED, MAYBE_CHECK_NO, RETURNED_TO_CALLER } from "@haibun/core/schema/protocol.js";
import { MARK_COLOUR, eventMarkerStyle , bucketMarkerStyle } from "./event-marker.js";

const step = (over: Record<string, unknown>) => ({ kind: "lifecycle", type: "step", id: "1700000000000-1.0.1.2", ...over });

describe("what a mark says about a step", () => {
	it("marks a run's own failure as a failure", () => {
		const mark = eventMarkerStyle(step({ status: "failed" }));
		expect(mark.icon).toBe(CHECK_NO);
		expect(mark.color).toBe(MARK_COLOUR.fault);
	});

	it("marks a statement the run merely tried with the diamond, in a colour that is not a fault", () => {
		const mark = eventMarkerStyle(step({ status: "failed", intent: { mode: "speculative" } }));
		expect(mark.icon).toBe(MAYBE_CHECK_NO);
		expect(mark.color).not.toBe(MARK_COLOUR.fault);
	});

	it("marks a handed-out call's failure as returned to its caller", () => {
		const mark = eventMarkerStyle(step({ status: "failed", id: "0.-1.2" }));
		expect(mark.icon).toBe(RETURNED_TO_CALLER);
		expect(mark.color).not.toBe(MARK_COLOUR.fault);
	});

	it("marks a step that passed as passed, and a speculative one as merely held", () => {
		expect(eventMarkerStyle(step({ status: "passed" })).icon, "the outcome a step's record states").toBe(ICON_STEP_COMPLETED);
		expect(eventMarkerStyle(step({ status: "passed", intent: { mode: "speculative" } })).icon).not.toBe(ICON_STEP_COMPLETED);
	});
});

describe("the mark a division of the run earns", () => {
	const step = (status: string) => ({ kind: "lifecycle", type: "step", stage: "end", status });
	const said = (level: string) => ({ kind: "log", level });

	it("marks as a failure where it holds one, so a failure is not averaged away by the successes around it", () => {
		const held = [
			{ event: step("passed"), count: 40 },
			{ event: step("failed"), count: 1 },
		];
		expect(bucketMarkerStyle(held)?.color).toBe(MARK_COLOUR.fault);
	});

	it("marks as a failure for a message reporting one, the same as for a step", () => {
		expect(bucketMarkerStyle([{ event: said("info"), count: 99 }, { event: said("error"), count: 1 }])?.color).toBe(MARK_COLOUR.fault);
	});

	it("marks as whatever it holds most of, where it holds no failure", () => {
		const held = [
			{ event: step("passed"), count: 3 },
			{ event: said("warn"), count: 7 },
		];
		expect(bucketMarkerStyle(held)?.color).toBe(MARK_COLOUR.pending);
	});

	it("marks a division holding nothing with nothing, so an empty stretch of the run draws as empty", () => {
		expect(bucketMarkerStyle([])).toBeUndefined();
		expect(bucketMarkerStyle([{ event: step("passed"), count: 0 }])).toBeUndefined();
	});

	it("marks the same way for the same counts, whatever order they arrive in", () => {
		const a = [{ event: step("passed"), count: 2 }, { event: said("warn"), count: 2 }];
		expect(bucketMarkerStyle(a)).toEqual(bucketMarkerStyle([...a].reverse()));
	});

	it("does not report a failure the log would not, since it marks by the one rule an event marks by", () => {
		// A speculative statement's failure is expected, which eventMarkerStyle already states.
		const held = [{ event: { kind: "lifecycle", type: "step", stage: "end", status: "failed", intent: { mode: "speculative" } }, count: 1 }];
		expect(bucketMarkerStyle(held)?.color).not.toBe(MARK_COLOUR.fault);
	});
});
