// @vitest-environment jsdom
/**
 * Behaviour contract for shu-column-pane + shu-column-strip header buttons + maximize.
 *
 * The user-facing complaints these tests pin down:
 *   - minimize click reflects `collapsed` host attribute (column shrinks via CSS rule)
 *   - maximize click reflects `data-maximized` host attribute and bubbles COLUMN_MAXIMIZE
 *   - strip's maximize handler clears any inline `flex` on the maximizing pane so a
 *     prior resize doesn't pin its width; restores the original inline value on un-maximize
 *   - controls-toggle and pin click reflect `aria-pressed` so the SHU base style highlights
 *   - rightmost pane gets the `is-last` host attribute when added to the strip
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { ShuColumnPane } from "./shu-column-pane.js";
import { ShuColumnStrip } from "./shu-column-strip.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";

beforeAll(() => {
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

	it("setWidth applies inline flex; setWidth(undefined) restores flex:1", () => {
		pane.setWidth(320);
		expect(pane.style.flex).toMatch(/^0 0 320px$/);
		pane.setWidth(undefined);
		expect(pane.style.flex.replace(/\s+/g, " ")).toMatch(/^(1|1 1 0%?)$/);
	});

	it("userWidth reflects an explicit resize so the accordion can treat it as fixed-width (not auto-collapse it)", () => {
		expect(pane.userWidth).toBeUndefined();
		pane.setWidth(320);
		expect(pane.userWidth).toBe(320);
		pane.setWidth(undefined);
		expect(pane.userWidth).toBeUndefined();
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
