// @vitest-environment jsdom
/**
 * annotation-rail helpers: finding the scroll ancestor across a shadow boundary (the annotated body is light DOM inside a
 * host shadow whose :host scrolls), reading the rail's pixel-space total/window from that ancestor, and mapping located
 * annotations to marks. Layout (sticky, real pixels) is a browser concern; these cover the DOM-reading logic.
 */
import { ANNOTATION_GLYPH } from "./consts.js";
import { describe, it, expect } from "vitest";
import { railTotalAndWindow, railMarks } from "./annotation-rail.js";

describe("railTotalAndWindow", () => {
	it("reads scrollHeight as total and scrollTop/clientHeight as the window", () => {
		const el = { scrollHeight: 7300, scrollTop: 2400.6, clientHeight: 600 } as unknown as HTMLElement;
		expect(railTotalAndWindow(el)).toEqual({ total: 7300, window: { first: 2401, visible: 600 } });
	});
});

describe("railMarks", () => {
	it("maps each located annotation to a mark at its rounded pixel offset", () => {
		const marks = railMarks([{ commentId: "c1", offset: 120.4, label: "a note" }], "#08f");
		expect(marks).toEqual([{ index: 120, id: "c1", icon: ANNOTATION_GLYPH, color: "#08f", label: "a note" }]);
	});
	it("is empty when nothing located", () => {
		expect(railMarks([], "#08f")).toEqual([]);
	});
});
