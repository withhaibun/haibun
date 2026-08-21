// @vitest-environment jsdom
// What the log marks on its rail: the rows whose events earned a mark, at the place a reader can scroll to; and where it
// marks the moment being shown. (The tail-vs-full window rule it tails by is shared, and tested in tail-window.test.ts.)
import { describe, it, expect } from "vitest";
import { cursorMark, railMarkers, type TLogRow } from "./shu-monitor-column.js";
import { markFor, MARK_COLOUR } from "../event-marker.js";

/** A log row, with only what the rail reads off it. */
const row = (over: Partial<TLogRow> = {}): TLogRow => ({ time: "0.0s", timestamp: 0, level: "info", step: "a-step", message: "", ...over });

describe("what a log marks on its rail", () => {
	it("marks the rows whose events earned a mark, and no others", () => {
		const marks = railMarkers([row(), row({ mark: { icon: "✅", color: MARK_COLOUR.ok } }), row()]);
		expect(marks.map((m) => m.index), "only the middle row earned one").toEqual([1]);
		expect(marks[0].icon).toBe("✅");
		expect(marks[0].color).toBe(MARK_COLOUR.ok);
	});

	it("places a mark at the row's index in the log it was given, which is the log a reader scrolls", () => {
		// The rows passed in are the FILTERED log. An index into the unfiltered one would scroll to the wrong row, or
		// past the end, whenever a level filter is on.
		const marks = railMarkers([row({ mark: { icon: "❌", color: MARK_COLOUR.fault } }), row(), row({ mark: { icon: "⚠️", color: MARK_COLOUR.pending } })]);
		expect(marks.map((m) => m.index)).toEqual([0, 2]);
	});

	it("labels a mark with what the row is about and what happened to it, so marks are told apart", () => {
		const marks = railMarkers([
			row({ mark: { icon: "❌", color: MARK_COLOUR.fault }, step: "check the total", message: "it went wrong" }),
			row({ mark: { icon: "▸", color: MARK_COLOUR.feature }, step: "a-feature", message: "▸ feature" }),
			row({ mark: { icon: "📦", color: MARK_COLOUR.artifact }, step: "", message: "saved" }),
		]);
		expect(marks[0].label).toBe("check the total it went wrong");
		expect(marks[1].label, "every feature boundary would read the same without the step").toBe("a-feature ▸ feature");
		expect(marks[2].label, "a row with no step is labelled by what it says").toBe("saved");
	});

	it("marks nothing for a log with nothing worth marking", () => {
		expect(railMarkers([row(), row()])).toEqual([]);
	});
});

describe("the rail marks what the timeline marks", () => {
	// Both take their mark from markFor, so this is what stops the two surfaces drifting: an event that marks the
	// timeline's track marks the log's rail too, in the same colour and glyph.
	const stepEnd = { kind: "lifecycle", type: "step", stage: "end", status: "completed", in: "A step a person can read" };
	const failure = { kind: "lifecycle", type: "step", stage: "end", status: "failed", in: "A step a person can read" };
	const debugLog = { kind: "log", level: "debug", message: "internal" };

	it("carries a completed step end, which the old rule (error and warn only) did not", () => {
		const mark = markFor(stepEnd);
		expect(mark, "the timeline marks it, so the rail does too").toBeDefined();
		expect(railMarkers([row({ mark })])).toHaveLength(1);
	});

	it("carries a failure in the colour the shared vocabulary gives it", () => {
		expect(railMarkers([row({ mark: markFor(failure) })])[0].color).toBe(MARK_COLOUR.fault);
	});

	it("carries nothing for the noise neither surface marks", () => {
		expect(markFor(debugLog)).toBeUndefined();
		expect(railMarkers([row({ mark: markFor(debugLog) })])).toEqual([]);
	});
});
