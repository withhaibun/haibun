/**
 * What a mark on a rail or a slider says, which must be what the log says.
 *
 * A rail that chooses its own glyph announces a failure the log does not: a passing run showed two red failure marks,
 * for a call it handed out and a statement it merely tried.
 */
import { describe, expect, it } from "vitest";
import { CHECK_NO, ICON_STEP_COMPLETED, MAYBE_CHECK_NO, RETURNED_TO_CALLER } from "@haibun/core/schema/protocol.js";
import { MARK_COLOUR, eventMarkerStyle } from "./event-marker.js";

const step = (over: Record<string, unknown>) => ({ kind: "lifecycle", type: "step", stage: "end", id: "0.1.2", ...over });

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

	it("marks a completed step as completed, and a speculative one as merely held", () => {
		expect(eventMarkerStyle(step({ status: "completed" })).icon).toBe(ICON_STEP_COMPLETED);
		expect(eventMarkerStyle(step({ status: "completed", intent: { mode: "speculative" } })).icon).not.toBe(ICON_STEP_COMPLETED);
	});
});
