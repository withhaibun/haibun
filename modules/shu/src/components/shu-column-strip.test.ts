// @vitest-environment jsdom
/**
 * Behaviour contract for shu-column-strip minimize handling:
 *   - a minimized column never stays active: activation shifts to the nearest expanded column to its
 *     right, falling back to the left when none remain on the right
 *   - minimize persists via the pane's own persistFields, so a re-added pane with the same column key
 *     restores minimized, without stealing activation
 *   - the strip's width is always fully used: the pane that grows into the leftover is the rightmost one that CAN
 *     grow, which is not the rightmost pane when that one is collapsed
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { ShuColumnPane } from "./shu-column-pane.js";
import { ShuColumnStrip } from "./shu-column-strip.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { flushPersistWrites, writeElementPrefs } from "../element-prefs.js";
import { setJsonCookie } from "../cookies.js";
import { activePane } from "../signals.js";

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
		activePane.set(null);
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
		expect(activePane.get()).toBe("C"); // the columnKey of panes[2]
	});

	it("falls back to the left when the minimized active column is rightmost", () => {
		strip.activatePane(2);
		minimize(panes[2]);
		expect(activePane.get()).toBe("B"); // the columnKey of panes[1]
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

/**
 * The invariant the harvest depends on: while panes are open, one of them is active.
 *
 * removePane already repairs activation when the active pane goes away. Nothing repaired it when a pane arrived while
 * the signal named nothing, so a strip could hold panes with `activePane` null, which is what made the Ask pane
 * report that nothing was selected while a column was plainly on screen.
 */
describe("shu-column-strip activation invariant", () => {
	let strip: ShuColumnStrip;

	beforeEach(async () => {
		flushPersistWrites();
		setJsonCookie("shu-prefs-shu-column-pane", {});
		activePane.set(null);
		document.body.innerHTML = "";
		strip = document.createElement("shu-column-strip") as ShuColumnStrip;
		document.body.appendChild(strip);
		await (strip as unknown as { updateComplete: Promise<unknown> }).updateComplete;
	});

	it("activates the first pane added when nothing is active", () => {
		strip.addPane(makePane("A") as ShuColumnPane & HTMLElement);
		expect(activePane.get()).toBe("A");
	});

	it("leaves an existing activation alone when another pane is added", () => {
		strip.addPane(makePane("A") as ShuColumnPane & HTMLElement);
		strip.addPane(makePane("B") as ShuColumnPane & HTMLElement);
		expect(activePane.get()).toBe("A");
	});

	it("leaves a signal naming a pane that is not open yet, which is a restore about to attach it", () => {
		activePane.set("p:Scene:generatedAtTime");
		strip.addPane(makePane("query") as ShuColumnPane & HTMLElement);
		// Claiming "query" here would steal activation from the pane the restore is about to add.
		expect(activePane.get()).toBe("p:Scene:generatedAtTime");
	});

	it("activates a remaining pane when the only active one is removed, and clears when none remain", () => {
		strip.addPane(makePane("A") as ShuColumnPane & HTMLElement);
		strip.addPane(makePane("B") as ShuColumnPane & HTMLElement);
		strip.removePane(0);
		expect(activePane.get()).toBe("B");
		strip.removePane(0);
		expect(activePane.get()).toBeNull();
	});
});

describe("which pane grows into the strip's leftover width", () => {
	let strip: ShuColumnStrip;
	let panes: ShuColumnPane[];

	beforeEach(async () => {
		flushPersistWrites();
		setJsonCookie("shu-prefs-shu-column-pane", {});
		activePane.set(null);
		document.body.innerHTML = "";
		strip = document.createElement("shu-column-strip") as ShuColumnStrip;
		document.body.appendChild(strip);
		await (strip as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		panes = [makePane("A"), makePane("B"), makePane("C")];
		for (const p of panes) strip.addPane(p as ShuColumnPane & HTMLElement);
	});

	const grower = () => panes.find((p) => p.hasAttribute(SHU_ATTR.GROWS))?.getAttribute("label");

	it("is the rightmost pane while that pane can grow", () => {
		expect(grower()).toBe("C");
		expect(panes[2].hasAttribute(SHU_ATTR.IS_LAST), "which is also the rightmost").toBe(true);
	});

	it("moves to the pane before it when the rightmost is collapsed, so no width belongs to nobody", () => {
		minimize(panes[2]);
		expect(grower()).toBe("B");
		expect(panes[2].hasAttribute(SHU_ATTR.IS_LAST), "the collapsed one is still the rightmost, it just cannot grow").toBe(true);
	});

	it("skips a run of collapsed columns on the right rather than stopping at the first", () => {
		minimize(panes[2]);
		minimize(panes[1]);
		expect(grower()).toBe("A");
	});

	it("gives it back when the rightmost column is opened again", () => {
		minimize(panes[2]);
		expect(grower()).toBe("B");
		panes[2].setMinimized(false);
		panes[2].dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MINIMIZE, { detail: { minimized: false }, bubbles: true, composed: true }));
		expect(grower()).toBe("C");
	});
});
