// @vitest-environment jsdom
/**
 * The column renders rows by index and draws a rail beside them. Where the source states a rail of its own, the column
 * draws that rail and hands a press back to the source: a window of a longer set is not the whole of it.
 */
import { describe, it, expect } from "vitest";
import { html } from "lit";
import type { WindowedSource } from "../windowed-source.js";
import type { ShuVirtualColumn } from "./shu-virtual-column.js";
import "./shu-virtual-column.js";
import { SCROLL_TO_INDEX } from "./shu-scrollbar.js";

describe("a column whose rows are a window of something longer", () => {
	it("draws the rail the source states, and asks the source where a press lands", async () => {
		const asked: number[] = [];
		const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
		const source: WindowedSource<{ id: number }> & { rail: NonNullable<WindowedSource<unknown>["rail"]> } = {
			count: () => rows.length,
			rowAt: (i) => rows[i],
			ensureRange: async () => undefined,
			subscribe: () => () => undefined,
			markers: () => [{ index: 1, id: "held", color: "#000", icon: "x" }],
			rail: {
				places: 100,
				placeOf: (index) => index * 10,
				marks: () => [{ index: 90, id: "long ago", color: "#f00", icon: "!" }],
				goTo: (place) => asked.push(place),
			},
		};
		const column = document.createElement("shu-virtual-column") as ShuVirtualColumn;
		column.source = source as unknown as WindowedSource<unknown>;
		column.renderRow = (i: number) => html`<div>${i}</div>`;
		// The rail is what a column shows as a strip, which is where a reader reads a long run from.
		column.spine = true;
		document.body.append(column);
		await column.updateComplete;
		const rail = column.querySelector("shu-scrollbar") as (HTMLElement & { total: number; markers: Array<{ index: number; id: string }> }) | null;
		expect(rail?.total, "the rail has the places the source states, not the rows this column holds").toBe(100);
		expect(rail?.markers.map((m) => m.id).sort(), "what the run marks and what this column holds, in the run's places").toEqual(["held", "long ago"]);
		expect(rail?.markers.find((m) => m.id === "held")?.index, "the held row is placed where the run has it").toBe(10);
		column.dispatchEvent(new CustomEvent(SCROLL_TO_INDEX, { detail: { index: 42 }, bubbles: true, composed: true }));
		expect(asked, "the press is the source's to answer").toEqual([42]);
	});
});
