// @vitest-environment jsdom
// The monitor's tail-vs-full window decision, unit-tested pure (no virtualizer): following the live edge bounds the shared
// log to a tail below the newest event; scrolled back it is the whole history; a run shorter than the tail is the whole log.
import { describe, it, expect } from "vitest";
import { monitorTailWindow } from "./shu-monitor-column.js";

const INF = Number.POSITIVE_INFINITY;

describe("monitorTailWindow", () => {
	it("is the full history when not following (a scrolled-back reader must reach anything)", () => {
		expect(monitorTailWindow(false, 1_000_000)).toEqual([{ from: 0, to: INF }]);
	});

	it("is a bounded tail below the newest event when following a long run", () => {
		expect(monitorTailWindow(true, 1_000_000, 600_000)).toEqual([{ from: 400_000, to: INF }]);
	});

	it("clamps `from` at 0 — a run shorter than the tail is the whole log (no eviction)", () => {
		expect(monitorTailWindow(true, 300_000, 600_000)).toEqual([{ from: 0, to: INF }]);
	});
});
