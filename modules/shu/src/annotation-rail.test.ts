// @vitest-environment jsdom
/**
 * annotation-rail helpers: finding the scroll ancestor across a shadow boundary (the annotated body is light DOM inside a
 * host shadow whose :host scrolls), reading the rail's pixel-space total/window from that ancestor, and mapping located
 * annotations to marks. Layout (sticky, real pixels) is a browser concern; these cover the DOM-reading logic.
 */
import { describe, it, expect } from "vitest";
import { findScrollAncestor, railTotalAndWindow, railMarks } from "./annotation-rail.js";

describe("findScrollAncestor", () => {
	it("finds the nearest overflow:auto ancestor", () => {
		const scroller = document.createElement("div");
		scroller.style.overflowY = "auto";
		const child = document.createElement("div");
		scroller.appendChild(child);
		document.body.appendChild(scroller);
		expect(findScrollAncestor(child)).toBe(scroller);
		scroller.remove();
	});
	it("crosses a shadow boundary to a scrolling host ancestor", () => {
		const scroller = document.createElement("div");
		scroller.style.overflowY = "scroll";
		document.body.appendChild(scroller);
		const host = document.createElement("div");
		scroller.appendChild(host);
		const shadow = host.attachShadow({ mode: "open" });
		const inner = document.createElement("div");
		shadow.appendChild(inner);
		expect(findScrollAncestor(inner)).toBe(scroller);
		scroller.remove();
	});
	it("returns null when nothing between here and the document scrolls", () => {
		const plain = document.createElement("div");
		const child = document.createElement("div");
		plain.appendChild(child);
		document.body.appendChild(plain);
		expect(findScrollAncestor(child)).toBeNull();
		plain.remove();
	});
});

describe("railTotalAndWindow", () => {
	it("reads scrollHeight as total and scrollTop/clientHeight as the window", () => {
		const el = { scrollHeight: 7300, scrollTop: 2400.6, clientHeight: 600 } as unknown as HTMLElement;
		expect(railTotalAndWindow(el)).toEqual({ total: 7300, window: { first: 2401, visible: 600 } });
	});
});

describe("railMarks", () => {
	it("maps each located annotation to a mark at its rounded pixel offset", () => {
		const marks = railMarks([{ commentId: "c1", offset: 120.4, label: "a note" }], "#08f");
		expect(marks).toEqual([{ index: 120, id: "c1", icon: "📝", color: "#08f", label: "a note" }]);
	});
	it("is empty when nothing located", () => {
		expect(railMarks([], "#08f")).toEqual([]);
	});
});
