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

/** Flush any pending debounced persistence and clear the pane prefs cookie so tests are isolated. */
function resetPanePrefs(): void {
	flushPersistWrites();
	setJsonCookie("shu-prefs-shu-column-pane", {});
}

beforeAll(() => {
	// jsdom has no scrollIntoView; stub it so the strip's post-add scroll doesn't raise uncaught errors that bury real failures.
	if (!Element.prototype.scrollIntoView)
		Element.prototype.scrollIntoView = () => {
			/* jsdom has no layout to scroll */
		};
	if (!customElements.get("shu-column-pane")) customElements.define("shu-column-pane", ShuColumnPane);
	if (!customElements.get("shu-column-strip")) customElements.define("shu-column-strip", ShuColumnStrip);
});

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
		expect(pane.getAttribute("pinned")).toBe("true");
		const btn = pane.shadowRoot?.querySelector(".pane-pin") as HTMLButtonElement;
		expect(btn.getAttribute("aria-pressed")).toBe("true");
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

	it("setWidth applies inline flex; setWidth(undefined) defers to the :host flex default", () => {
		pane.setWidth(320);
		expect(pane.style.flex).toMatch(/^0 0 320px$/);
		pane.setWidth(undefined);
		expect(pane.style.flex).toBe("");
	});

	it("fixedWidth reflects an explicit resize so the accordion can treat it as fixed-width (not auto-collapse it)", () => {
		expect(pane.fixedWidth).toBeUndefined();
		pane.setWidth(320);
		expect(pane.fixedWidth).toBe(320);
		pane.setWidth(undefined);
		expect(pane.fixedWidth).toBeUndefined();
	});

	it("a last pane renders flexible but keeps its stored width, reapplying it when it stops being last", () => {
		pane.setWidth(320);
		pane.toggleAttribute(SHU_ATTR.IS_LAST, true);
		expect(pane.style.flex).toBe("");
		expect(pane.fixedWidth).toBeUndefined();
		pane.toggleAttribute(SHU_ATTR.IS_LAST, false);
		expect(pane.style.flex).toBe("0 0 320px");
		expect(pane.fixedWidth).toBe(320);
	});

	it("persists width and minimize per column key and restores both on a fresh pane with that key (the reload contract)", async () => {
		pane.setWidth(280);
		pane.setMinimized(true);
		flushPersistWrites();
		const again = makePane(); // same label → same columnKey
		document.body.appendChild(again);
		await nextFrame(again);
		expect(again.fixedWidth).toBe(280);
		expect(again.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(true);
		expect(again.hasAttribute("collapsed")).toBe(true);
	});

	it("an explicit pre-attach state (a URL-hash flag) outranks the remembered value; untouched fields still restore", async () => {
		pane.setWidth(280); // persists { width: 280, minimized: false }
		flushPersistWrites();
		const again = makePane();
		again.setMinimized(true); // hash flag ~min applied before attach
		document.body.appendChild(again);
		await nextFrame(again);
		expect(again.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).toBe(true);
		expect(again.fixedWidth).toBe(280);
	});

	it("resize handle drag updates inline flex through document mousemove and emits column-resize on mouseup", () => {
		// jsdom does not lay out, so offsetWidth is 0; the resize handler clamps to MIN_RESIZED_WIDTH (120) so this assertion is independent of layout.
		const handle = pane.shadowRoot?.querySelector(".resize-handle") as HTMLElement;
		expect(handle).toBeTruthy();
		let resized: { width: number | undefined } | null = null;
		pane.addEventListener(SHU_EVENT.COLUMN_RESIZE, (e) => {
			resized = (e as CustomEvent).detail;
		});
		handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, clientX: 100 }));
		document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 260 }));
		expect(pane.style.flex).toMatch(/^0 0 \d+px$/);
		document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
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

	it("maximize hides every other pane (display:none), clears inline flex on the max pane, restores both on un-maximize", async () => {
		const a = await addPane("A");
		const b = await addPane("B");
		a.setWidth(320);
		expect(a.style.flex).toBe("0 0 320px");
		a.setAttribute(SHU_ATTR.DATA_MAXIMIZED, "");
		a.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MAXIMIZE, { detail: { maximized: true }, bubbles: true, composed: true }));
		await nextFrame(strip);
		expect(a.style.flex.replace(/\s+/g, " ")).toMatch(/^(1|1 1 0%?)$/);
		expect(b.style.display).toBe("none");
		expect(a.style.display).not.toBe("none");
		a.removeAttribute(SHU_ATTR.DATA_MAXIMIZED);
		a.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MAXIMIZE, { detail: { maximized: false }, bubbles: true, composed: true }));
		await nextFrame(strip);
		expect(a.style.flex).toMatch(/^0 0 320px$/);
		expect(b.style.display).toBe("");
	});
});
