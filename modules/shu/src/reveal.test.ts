import { describe, expect, it } from "vitest";
import { alignedBy } from "./reveal.js";

/** A view from 100 to 200, as a scroller shows it. */
const VIEW = [100, 200] as const;

describe("alignedBy", () => {
	it("places a span at the view's start, end or center", () => {
		expect(alignedBy(250, 270, ...VIEW, "start")).toBe(150);
		expect(alignedBy(250, 270, ...VIEW, "end")).toBe(70);
		expect(alignedBy(250, 270, ...VIEW, "center")).toBe(110);
	});

	it("scrolls the least that shows a span, as nearest does", () => {
		expect(alignedBy(120, 180, ...VIEW, "nearest"), "a span in view doesn't scroll").toBe(0);
		expect(alignedBy(80, 120, ...VIEW, "nearest"), "a span above the view is placed at its start").toBe(-20);
		expect(alignedBy(180, 220, ...VIEW, "nearest"), "a span below the view is placed at its end").toBe(20);
		expect(alignedBy(50, 300, ...VIEW, "nearest"), "a span larger than the view and over it doesn't scroll").toBe(0);
		expect(alignedBy(150, 400, ...VIEW, "nearest"), "a span larger than the view, below its start, is placed at its start").toBe(50);
		expect(alignedBy(0, 150, ...VIEW, "nearest"), "a span larger than the view, above its end, is placed at its end").toBe(-50);
	});
});
