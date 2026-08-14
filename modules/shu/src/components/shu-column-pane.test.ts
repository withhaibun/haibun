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
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { ShuColumnPane } from "./shu-column-pane.js";
import { ShuColumnStrip } from "./shu-column-strip.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
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

	it("a last pane renders flexible but keeps its stored width, reapplying it when it stops being last", () => {
		stripWidth(pane.parentElement as HTMLElement, 1000);
		pane.setWidth(0.32);
		pane.toggleAttribute(SHU_ATTR.IS_LAST, true);
		expect(pane.style.flex).toBe("");
		expect(pane.fixedWidth).toBeUndefined();
		pane.toggleAttribute(SHU_ATTR.IS_LAST, false);
		expect(pane.style.flex).toBe("0 0 32.000%");
		expect(pane.fixedWidth).toBe(320);
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
