// @vitest-environment jsdom
/**
 * Behaviour contract for shu-column-strip minimize handling:
 *   - a minimized column never stays active: activation shifts to the nearest expanded column to its
 *     right, falling back to the left when none remain on the right
 *   - minimize state persists to a cookie and a re-added pane with the same key restores minimized,
 *     without stealing activation
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { ShuColumnPane } from "./shu-column-pane.js";
import { ShuColumnStrip } from "./shu-column-strip.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";

beforeAll(() => {
	if (!customElements.get("shu-column-pane")) customElements.define("shu-column-pane", ShuColumnPane);
	if (!customElements.get("shu-column-strip")) customElements.define("shu-column-strip", ShuColumnStrip);
});

function makePane(label: string): ShuColumnPane {
	const pane = document.createElement("shu-column-pane") as ShuColumnPane;
	pane.setAttribute("label", label);
	pane.setAttribute("column-type", "entity");
	pane.dataset.columnKey = label;
	return pane;
}

function minimize(pane: ShuColumnPane): void {
	pane.setAttribute(SHU_ATTR.DATA_MINIMIZED, "");
	pane.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MINIMIZE, { detail: { minimized: true }, bubbles: true, composed: true }));
}

describe("shu-column-strip minimize", () => {
	let strip: ShuColumnStrip;
	let panes: ShuColumnPane[];

	beforeEach(async () => {
		setJsonCookie("shu-pane-min", []);
		document.body.innerHTML = "";
		strip = document.createElement("shu-column-strip") as ShuColumnStrip;
		document.body.appendChild(strip);
		await (strip as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		panes = [makePane("A"), makePane("B"), makePane("C")];
		for (const p of panes) strip.addPane(p as ShuColumnPane & HTMLElement);
	});

	it("shifts activation to the next column on the right when the active column minimizes", () => {
		strip.activatePane(1);
		minimize(panes[1]);
		expect((strip as unknown as { state: { activeIndex: number } }).state.activeIndex).toBe(2);
	});

	it("falls back to the left when the minimized active column is rightmost", () => {
		strip.activatePane(2);
		minimize(panes[2]);
		expect((strip as unknown as { state: { activeIndex: number } }).state.activeIndex).toBe(1);
	});

	it("persists minimized keys to the cookie and clears them on expand", () => {
		minimize(panes[1]);
		expect(getJsonCookie<string[]>("shu-pane-min", [])).toEqual(["B"]);
		panes[1].dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_EXPAND, { bubbles: true, composed: true }));
		expect(getJsonCookie<string[]>("shu-pane-min", [])).toEqual([]);
	});

	it("restores a cookie-minimized pane as minimized without giving it activation", () => {
		setJsonCookie("shu-pane-min", ["D"]);
		const before = (strip as unknown as { state: { activeIndex: number } }).state.activeIndex;
		const d = makePane("D");
		strip.addPane(d as ShuColumnPane & HTMLElement);
		expect(d.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(true);
		expect((strip as unknown as { state: { activeIndex: number } }).state.activeIndex).toBe(before);
	});
});
