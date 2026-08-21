// @vitest-environment jsdom
/**
 * Behaviour contract for shu-column-pane + shu-column-strip header buttons + maximize.
 *
 * The user-facing complaints these tests pin down:
 *   - minimize click reflects `collapsed` host attribute (column shrinks via CSS rule)
 *   - maximize click reflects `data-maximized` host attribute and bubbles COLUMN_MAXIMIZE
 *   - a pane's inline flex is derived from its full state (width, is-last, maximized, collapsed),
 *     so a maximize or is-last phase never destroys a stored width
 *   - width + minimize persist per column key and restore on a fresh pane (the reload contract)
 *   - controls-toggle and pin click reflect `aria-pressed` so the SHU base style highlights
 *   - rightmost pane gets the `is-last` host attribute when added to the strip
 *   - collapsed, a pane renders its spine slot and not its default one, so a column's main view is not rendered
 *     while it is collapsed and its spine view is not rendered while it is not
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { ShuColumnPane } from "./shu-column-pane.js";
import { ShuColumnStrip } from "./shu-column-strip.js";
import { SHU_EVENT, SHU_ATTR, SPINE_SLOT } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { flushPersistWrites } from "../element-prefs.js";
import { setJsonCookie } from "../cookies.js";
import { installTestMediaQueries } from "../test-setup.js";

/** Flush any pending debounced persistence and clear the pane prefs cookie so tests are isolated. */
function resetPanePrefs(): void {
	flushPersistWrites();
	setJsonCookie("shu-prefs-shu-column-pane", {});
}

beforeAll(() => {
	installTestMediaQueries(); // the strip asks the viewport whether it is narrow or portrait; jsdom answers no such question
	// jsdom has no scrollIntoView; stub it so the strip's post-add scroll doesn't raise uncaught errors that bury real failures.
	if (!Element.prototype.scrollIntoView)
		Element.prototype.scrollIntoView = () => {
			/* jsdom has no layout to scroll */
		};
	if (!customElements.get("shu-column-pane")) customElements.define("shu-column-pane", ShuColumnPane);
	if (!customElements.get("shu-column-strip")) customElements.define("shu-column-strip", ShuColumnStrip);
});

/** jsdom lays nothing out, so a strip's width is stated: the pane converts between its share and pixels against it. */
function stripWidth(el: HTMLElement, px: number): void {
	Object.defineProperty(el, "clientWidth", { value: px, configurable: true });
}

function makePane(label = "Test", columnType = "entity"): ShuColumnPane {
	const pane = document.createElement("shu-column-pane") as ShuColumnPane;
	pane.setAttribute("label", label);
	pane.setAttribute("column-type", columnType);
	pane.dataset.columnKey = label;
	return pane;
}

async function nextFrame(el: HTMLElement): Promise<void> {
	const liteEl = el as unknown as { updateComplete?: Promise<unknown> };
	if (liteEl.updateComplete) await liteEl.updateComplete;
}

describe("shu-column-pane buttons", () => {
	let pane: ShuColumnPane;

	beforeEach(async () => {
		resetPanePrefs();
		document.body.innerHTML = "";
		pane = makePane();
		document.body.appendChild(pane);
		await nextFrame(pane);
	});

	const click = async (selector: string) => {
		const btn = pane.shadowRoot?.querySelector(selector) as HTMLButtonElement | null;
		if (!btn) throw new Error(`button not found: ${selector}`);
		btn.click();
		await nextFrame(pane);
	};

	it("minimize toggles collapsed + data-minimized host attributes", async () => {
		expect(pane.hasAttribute("collapsed")).toBe(false);
		await click(".pane-minimize");
		expect(pane.hasAttribute("collapsed")).toBe(true);
		expect(pane.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(true);
		await click(".pane-minimize");
		expect(pane.hasAttribute("collapsed")).toBe(false);
		expect(pane.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(false);
	});

	it("maximize sets aria-pressed on its button and dispatches column-maximize with detail", async () => {
		let seen: { maximized: boolean } | null = null;
		pane.addEventListener(SHU_EVENT.COLUMN_MAXIMIZE, (e) => {
			seen = (e as CustomEvent).detail;
		});
		await click(".pane-maximize");
		expect(pane.hasAttribute(SHU_ATTR.DATA_MAXIMIZED)).toBe(true);
		const btn = pane.shadowRoot?.querySelector(".pane-maximize") as HTMLButtonElement;
		expect(btn.getAttribute("aria-pressed")).toBe("true");
		expect(seen).toEqual({ maximized: true });
	});

	it("controls-toggle sets data-show-controls on the slotted child and reflects aria-pressed", async () => {
		const child = document.createElement("div");
		pane.appendChild(child);
		await nextFrame(pane);
		await click(".pane-controls");
		expect(child.hasAttribute(SHU_ATTR.SHOW_CONTROLS)).toBe(true);
		const btn = pane.shadowRoot?.querySelector(".pane-controls") as HTMLButtonElement;
		expect(btn.getAttribute("aria-pressed")).toBe("true");
		await click(".pane-controls");
		expect(child.hasAttribute(SHU_ATTR.SHOW_CONTROLS)).toBe(false);
	});

	it("pin toggles host pinned attribute and reflects aria-pressed", async () => {
		await click(".pane-pin");
		expect(pane.hasAttribute("pinned")).toBe(true); // presence is what pane-state's prune reads; the value is not significant
		const btn = pane.shadowRoot?.querySelector(".pane-pin") as HTMLButtonElement;
		expect(btn.getAttribute("aria-pressed")).toBe("true");
		await click(".pane-pin");
		expect(pane.hasAttribute("pinned")).toBe(false); // unpin removes it
		expect(btn.getAttribute("aria-pressed")).toBe("false");
	});

	it("close button dispatches column-close (no DOM removal on its own — PaneState owns that)", async () => {
		let closed = false;
		pane.addEventListener(SHU_EVENT.COLUMN_CLOSE, () => {
			closed = true;
		});
		await click(".pane-close");
		expect(closed).toBe(true);
		expect(pane.isConnected).toBe(true);
	});

	it("a width is a share of the strip, so it renders as a percentage and never as the pixels of another window", () => {
		stripWidth(pane.parentElement as HTMLElement, 1000);
		pane.setWidth(0.32);
		expect(pane.style.flex).toBe("0 0 32.000%");
		pane.setWidth(undefined);
		expect(pane.style.flex).toBe("");
	});

	it("caps a share at what the strip can give, so one restored from a wider window cannot crush the others", () => {
		const strip = pane.parentElement as HTMLElement;
		stripWidth(strip, 1000);
		const sibling = makePane("Other");
		strip.appendChild(sibling);
		pane.setWidth(1);
		// The sibling keeps a usable minimum: this pane renders at the rest, not at the whole strip.
		expect(Number.parseFloat(pane.style.flex.replace("0 0 ", ""))).toBeLessThan(100);
	});

	it("fixedWidth is that share in the strip's own pixels, which is what the accordion counts as fixed", () => {
		stripWidth(pane.parentElement as HTMLElement, 1000);
		expect(pane.fixedWidth).toBeUndefined();
		pane.setWidth(0.32);
		expect(pane.fixedWidth).toBe(320);
		pane.setWidth(undefined);
		expect(pane.fixedWidth).toBeUndefined();
	});

	it("the growing pane renders flexible but keeps its stored width, reapplying it when it stops growing", () => {
		stripWidth(pane.parentElement as HTMLElement, 1000);
		pane.setWidth(0.32);
		pane.toggleAttribute(SHU_ATTR.GROWS, true);
		expect(pane.style.flex).toBe("");
		expect(pane.fixedWidth).toBeUndefined();
		pane.toggleAttribute(SHU_ATTR.GROWS, false);
		expect(pane.style.flex).toBe("0 0 32.000%");
		expect(pane.fixedWidth).toBe(320);
	});

	it("being rightmost is not what makes a pane grow, since the rightmost pane can be collapsed", () => {
		// The two were once one attribute, which is how a collapsed rightmost column left the strip's remaining width
		// belonging to nobody. `is-last` drops the resize handle and the right border; `grows` takes the leftover width.
		stripWidth(pane.parentElement as HTMLElement, 1000);
		pane.setWidth(0.32);
		pane.toggleAttribute(SHU_ATTR.IS_LAST, true);
		expect(pane.style.flex, "rightmost and not marked as growing keeps its own width").toBe("0 0 32.000%");
	});

	it("persists width, minimize, and pin per column key and restores all on a fresh pane with that key (the reload contract)", async () => {
		await click(".pane-pin"); // pin the column
		stripWidth(pane.parentElement as HTMLElement, 1000);
		pane.setWidth(0.28);
		pane.setMinimized(true);
		flushPersistWrites();
		const again = makePane(); // same label → same columnKey
		document.body.appendChild(again);
		await nextFrame(again);
		stripWidth(again.parentElement as HTMLElement, 1000);
		expect(again.fixedWidth).toBe(280);
		expect(again.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(true);
		expect(again.hasAttribute("collapsed")).toBe(true);
		expect(again.hasAttribute("pinned")).toBe(true); // pin survives reload and re-asserts the attribute pane-state's prune reads
	});

	it("forgets a closed column's width, minimize and pin — reopening one is a new column, not the dismissed one", async () => {
		await click(".pane-pin");
		pane.setWidth(280);
		pane.setMinimized(true);
		await click(".pane-close"); // the reader dismisses the column
		flushPersistWrites(); // a write still owed must not put back what the close forgot
		const again = makePane(); // same label → same columnKey
		document.body.appendChild(again);
		await nextFrame(again);
		expect(again.hasAttribute("pinned")).toBe(false);
		expect(again.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(false);
		expect(again.fixedWidth).toBeUndefined();
	});

	it("an explicit pre-attach state (a URL-hash flag) outranks the remembered value; untouched fields still restore", async () => {
		stripWidth(pane.parentElement as HTMLElement, 1000);
		pane.setWidth(0.28); // persists { width: 0.28, minimized: false }
		flushPersistWrites();
		const again = makePane();
		again.setMinimized(true); // hash flag ~min applied before attach
		document.body.appendChild(again);
		await nextFrame(again);
		expect(again.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(true);
		stripWidth(again.parentElement as HTMLElement, 1000);
		expect(again.fixedWidth).toBe(280);
	});

	it("resizing a maximized pane takes it out of maximize and applies the width, rather than discarding the drag", () => {
		// A maximized pane renders flex:1, so a drag that only set a width was silently dropped: the handle was there, the
		// cursor said col-resize, and nothing moved.
		stripWidth(pane.parentElement as HTMLElement, 1000);
		let maximizeEvent: { maximized: boolean } | null = null;
		pane.addEventListener(SHU_EVENT.COLUMN_MAXIMIZE, (e) => {
			maximizeEvent = (e as CustomEvent).detail;
		});
		pane.setMaximized(true);
		expect(pane.style.flex.replace(/\s+/g, " ")).toMatch(/^(1|1 1 0%?)$/);
		const handle = pane.shadowRoot?.querySelector(".resize-handle") as HTMLElement;
		handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, clientX: 100 }));
		document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 400 }));
		document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
		expect(pane.hasAttribute(SHU_ATTR.DATA_MAXIMIZED)).toBe(false);
		expect((maximizeEvent as unknown as { maximized: boolean } | null)?.maximized).toBe(false); // the strip hears it, so the panes it hid come back
		expect(pane.style.flex).toBe("0 0 30.000%");
	});

	it("resize handle drag updates inline flex as the pointer moves and reports the width when it is released", () => {
		// jsdom does not lay out, so offsetWidth starts at 0 and the drag's 160px is the whole width; the stated strip
		// width is what those pixels become a share of.
		stripWidth(pane.parentElement as HTMLElement, 1000);
		const handle = pane.shadowRoot?.querySelector(".resize-handle") as HTMLElement;
		expect(handle).toBeTruthy();
		let resized: { width: number | undefined } | null = null;
		pane.addEventListener(SHU_EVENT.COLUMN_RESIZE, (e) => {
			resized = (e as CustomEvent).detail;
		});
		handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, clientX: 100 }));
		document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 260 }));
		expect(pane.style.flex).toBe("0 0 16.000%"); // 160px dragged, as a share of the 1000px strip
		document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
		expect(resized).not.toBeNull();
		expect(typeof (resized as unknown as { width: number }).width).toBe("number");
	});
});

describe("shu-column-strip maximize + is-last", () => {
	let strip: ShuColumnStrip;

	beforeEach(async () => {
		document.body.innerHTML = "";
		strip = document.createElement("shu-column-strip") as ShuColumnStrip;
		document.body.appendChild(strip);
		await nextFrame(strip);
	});

	const addPane = async (label: string): Promise<ShuColumnPane> => {
		const pane = makePane(label);
		strip.addPane(pane);
		await nextFrame(pane);
		await nextFrame(strip);
		return pane;
	};

	it("marks the rightmost pane with is-last; previous rightmost loses it", async () => {
		const a = await addPane("A");
		expect(a.hasAttribute(SHU_ATTR.IS_LAST)).toBe(true);
		const b = await addPane("B");
		expect(a.hasAttribute(SHU_ATTR.IS_LAST)).toBe(false);
		expect(b.hasAttribute(SHU_ATTR.IS_LAST)).toBe(true);
	});

	it("opening a column while another is maximized ends the maximize, so both are visible", async () => {
		// A maximized column is the only one visible: the panes present at the moment of maximize are hidden. A column
		// opened afterwards — a second col= in the hash, a column opened from a view — was left on screen beside the
		// maximized one, which is neither state. It was opened to be read, so the maximize ends.
		const a = await addPane("A");
		a.setMaximized(true);
		await nextFrame(strip);
		const late = await addPane("Late");
		await nextFrame(strip);
		expect(a.hasAttribute(SHU_ATTR.DATA_MAXIMIZED)).toBe(false);
		expect(late.style.display).not.toBe("none");
		expect(a.style.display).not.toBe("none");
	});

	it("maximize hides every other pane (display:none), clears inline flex on the max pane, restores both on un-maximize", async () => {
		const a = await addPane("A");
		const b = await addPane("B");
		stripWidth(a.parentElement as HTMLElement, 1000);
		a.setWidth(0.32);
		expect(a.style.flex).toBe("0 0 32.000%");
		a.setAttribute(SHU_ATTR.DATA_MAXIMIZED, "");
		a.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MAXIMIZE, { detail: { maximized: true }, bubbles: true, composed: true }));
		await nextFrame(strip);
		expect(a.style.flex.replace(/\s+/g, " ")).toMatch(/^(1|1 1 0%?)$/);
		expect(b.style.display).toBe("none");
		expect(a.style.display).not.toBe("none");
		a.removeAttribute(SHU_ATTR.DATA_MAXIMIZED);
		a.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MAXIMIZE, { detail: { maximized: false }, bubbles: true, composed: true }));
		await nextFrame(strip);
		expect(a.style.flex).toBe("0 0 32.000%");
		expect(b.style.display).toBe("");
	});
});

describe("what a pane renders when it collapses", () => {
	let pane: ShuColumnPane;

	beforeEach(async () => {
		resetPanePrefs();
		document.body.innerHTML = "";
		pane = makePane("Spined");
		pane.appendChild(document.createElement("div"));
		const spine = document.createElement("span");
		spine.setAttribute("slot", SPINE_SLOT);
		pane.appendChild(spine);
		document.body.appendChild(pane);
		await nextFrame(pane);
	});

	// A slot's `name` is "" for the default slot however it was written, which is what "the default slot" means here.
	const slots = () => Array.from(pane.shadowRoot?.querySelectorAll("slot") ?? []).map((s) => s.name);

	it("renders only the default slot while it is open, so the spine view is not rendered", () => {
		expect(slots(), "one slot, unnamed").toEqual([""]);
	});

	it("renders only the spine slot once collapsed, so the column's main view is not rendered", async () => {
		pane.setMinimized(true);
		await nextFrame(pane);
		expect(slots(), "one slot, the spine's").toEqual([SPINE_SLOT]);
	});

	it("gives the main view back when it expands again", async () => {
		pane.setMinimized(true);
		await nextFrame(pane);
		pane.setMinimized(false);
		await nextFrame(pane);
		expect(slots()).toEqual([""]);
		expect(pane.children.length, "and the spine view stayed put, keeping whatever state it had").toBe(2);
	});

	it("says it has a spine, which is what widens the collapsed strip enough to show one", async () => {
		pane.setMinimized(true);
		await nextFrame(pane);
		expect(pane.hasAttribute(SHU_ATTR.HAS_SPINE)).toBe(true);
	});

	it("answers the column's own view, not its spine view, when asked which child is the column", () => {
		expect(pane.columnView?.tagName).toBe("DIV");
	});

	it("opens the column when the strip is clicked, since a spine says what is behind it", async () => {
		pane.setMinimized(true);
		await nextFrame(pane);
		let expanded = 0;
		pane.addEventListener(SHU_EVENT.COLUMN_EXPAND, () => expanded++);
		const spineBox = pane.shadowRoot?.querySelector(".pane-spine") as HTMLElement | null;
		if (!spineBox) throw new Error("collapsed pane rendered no spine to click");
		spineBox.click();
		expect(expanded).toBe(1);
	});

	it("leaves a control in the spine its own clicks, so using one is not asking for the column", async () => {
		const button = document.createElement("button");
		(pane.querySelector(`[slot="${SPINE_SLOT}"]`) as HTMLElement).appendChild(button);
		pane.setMinimized(true);
		await nextFrame(pane);
		let expanded = 0;
		pane.addEventListener(SHU_EVENT.COLUMN_EXPAND, () => expanded++);
		button.click();
		expect(expanded, "the button was used, not the strip around it").toBe(0);
	});
});

describe("a column whose spine is a narrow form of itself", () => {
	// Its strip is the column's own control surface — the log's rail is dragged and clicked to move through the run — so
	// a click there is the reader using it, not asking for the rows back.
	beforeAll(() => {
		if (!customElements.get("shu-self-spine-column"))
			customElements.define(
				"shu-self-spine-column",
				class extends HTMLElement {
					static rendersOwnSpine = true;
				},
			);
	});

	const spined = async () => {
		resetPanePrefs();
		document.body.innerHTML = "";
		const pane = makePane("Self");
		pane.appendChild(document.createElement("shu-self-spine-column"));
		document.body.appendChild(pane);
		await nextFrame(pane);
		pane.setMinimized(true);
		await nextFrame(pane);
		return pane;
	};

	it("keeps rendering the column, so the part it shows in the strip stays where it is", async () => {
		const pane = await spined();
		const slots = Array.from(pane.shadowRoot?.querySelectorAll("slot") ?? []).map((sl) => sl.name);
		expect(slots, "the default slot, inside the strip — not the spine slot").toEqual([""]);
		expect(pane.hasAttribute(SHU_ATTR.HAS_SPINE), "and the strip is sized for a spine").toBe(true);
	});

	it("tells the column it is serving as the strip, which is how it knows to render narrow", async () => {
		const pane = await spined();
		expect(pane.columnView?.hasAttribute(SHU_ATTR.SPINE)).toBe(true);
		pane.setMinimized(false);
		await nextFrame(pane);
		expect(pane.columnView?.hasAttribute(SHU_ATTR.SPINE), "and stops saying so once there is room again").toBe(false);
	});

	it("does not open the column when its strip is clicked, since that click was for the strip", async () => {
		const pane = await spined();
		let expanded = 0;
		pane.addEventListener(SHU_EVENT.COLUMN_EXPAND, () => expanded++);
		const strip = pane.shadowRoot?.querySelector(".pane-spine") as HTMLElement | null;
		if (!strip) throw new Error("a collapsed pane rendered no strip to click");
		strip.click();
		expect(expanded, "using the rail must not put the rows back under the reader").toBe(0);
	});

	it("is opened again by the control that minimized it, which is the only way back when the strip keeps its clicks", async () => {
		const pane = await spined();
		const restore = pane.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_PANE.MINIMIZE}"]`) as HTMLButtonElement | null;
		if (!restore) throw new Error("a collapsed pane rendered no control to open it with");
		expect(restore.title, "and says which way it goes").toBe("Restore");
		restore.click();
		await nextFrame(pane);
		expect(pane.isCollapsed, "the column is back").toBe(false);
		expect(pane.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_PANE.MINIMIZE}"]`)?.getAttribute("title")).toBe("Minimize");
	});
});

describe("a column that declares no spine view", () => {
	it("collapses to its rotated label alone, with no spine to render", async () => {
		resetPanePrefs();
		document.body.innerHTML = "";
		const pane = makePane("Bare");
		pane.appendChild(document.createElement("div"));
		document.body.appendChild(pane);
		await nextFrame(pane);
		pane.setMinimized(true);
		await nextFrame(pane);
		expect(pane.hasAttribute(SHU_ATTR.HAS_SPINE), "nothing is assigned to the spine slot").toBe(false);
		const assigned = (pane.shadowRoot?.querySelector(`slot[name="${SPINE_SLOT}"]`) as HTMLSlotElement | null)?.assignedNodes() ?? [];
		expect(assigned.length, "so the strip shows the label and nothing else").toBe(0);
	});
});
