// @vitest-environment jsdom
/**
 * Behaviour contract for shu-column-strip minimize handling:
 *   - a minimized column never stays active: activation shifts to the nearest expanded column to its
 *     right, falling back to the left when none remain on the right
 *   - minimize persists via the pane's own persistFields, so a re-added pane with the same column key
 *     restores minimized — without stealing activation
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { ShuColumnPane } from "./shu-column-pane.js";
import { ShuColumnStrip } from "./shu-column-strip.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { flushPersistWrites, writeElementPrefs } from "../element-prefs.js";
import { setJsonCookie } from "../cookies.js";

beforeAll(() => {
	// jsdom has no scrollIntoView; stub it so the strip's post-add scroll doesn't raise uncaught errors that bury real failures.
	if (!Element.prototype.scrollIntoView)
		Element.prototype.scrollIntoView = () => {
			/* jsdom has no layout to scroll */
		};
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
	pane.setMinimized(true);
	pane.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MINIMIZE, { detail: { minimized: true }, bubbles: true, composed: true }));
}

describe("shu-column-strip minimize", () => {
	let strip: ShuColumnStrip;
	let panes: ShuColumnPane[];

	beforeEach(async () => {
		flushPersistWrites();
		setJsonCookie("shu-prefs-shu-column-pane", {});
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

	it("expand clears the persisted minimize so the column reopens expanded", () => {
		minimize(panes[1]);
		panes[1].dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_EXPAND, { bubbles: true, composed: true }));
		flushPersistWrites();
		const again = makePane("B");
		strip.addPane(again as ShuColumnPane & HTMLElement);
		expect(again.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(false);
	});

	it("restores a remembered-minimized pane as minimized without giving it activation", () => {
		writeElementPrefs("shu-column-pane", "D", { minimized: true });
		const before = (strip as unknown as { state: { activeIndex: number } }).state.activeIndex;
		const d = makePane("D");
		strip.addPane(d as ShuColumnPane & HTMLElement);
		expect(d.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(true);
		expect(d.hasAttribute(SHU_ATTR.COLLAPSED)).toBe(true);
		expect((strip as unknown as { state: { activeIndex: number } }).state.activeIndex).toBe(before);
	});
});
