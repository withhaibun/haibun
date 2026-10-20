// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { ShuArtifactFrame } from "./shu-artifact-frame.js";
import "./shu-artifact-frame.js";
import { SHU_EVENT } from "../../domains/elements.js";

const STEP = "the import authority's signing identity is created";
const stepCaption = (frame: Element) => (frame.shadowRoot as ShadowRoot).querySelector(".step-caption")?.textContent;
/** Presses the frame's fullscreen control, and waits for the frame to draw. */
async function toggleFullscreen(frame: Element): Promise<void> {
	const button = (frame.shadowRoot as ShadowRoot).querySelector<HTMLButtonElement>(".fullscreen-btn");
	if (button === null) throw new Error("the frame doesn't render its fullscreen control");
	button.click();
	await (frame as ShuArtifactFrame).updateComplete;
}
// A frame's data-step-id holds the id of the step that produced its artifact. The document column sets the caption when the
// frame opens, because under virtualization the step's block may not exist in the DOM.
async function frameIn(html: string): Promise<ShuArtifactFrame> {
	document.body.innerHTML = html;
	const frame = document.body.querySelector("shu-artifact-frame") as ShuArtifactFrame;
	await frame.updateComplete;
	return frame;
}
const stamped = `<div class="thumb-row"><shu-artifact-frame class="thumb" data-step-id="0.1.2"><img src="x.png" /></shu-artifact-frame></div>`;

describe("shu-artifact-frame fullscreen step caption", () => {
	it("shows the caption the column sets while fullscreen, and clears it on exit", async () => {
		const frame = await frameIn(stamped);
		expect(stepCaption(frame)).toBe(""); // not fullscreen
		await toggleFullscreen(frame);
		expect(frame.classList.contains("fullscreen")).toBe(true);
		frame.showStep(STEP);
		await frame.updateComplete;
		expect(stepCaption(frame)).toBe(STEP);
		await toggleFullscreen(frame);
		expect(frame.classList.contains("fullscreen")).toBe(false);
		expect(stepCaption(frame)).toBe("");
	});

	it("doesn't show a caption until a column sets one", async () => {
		const frame = await frameIn(`<shu-artifact-frame class="thumb"><img src="x.png" /></shu-artifact-frame>`);
		await toggleFullscreen(frame);
		expect(stepCaption(frame)).toBe("");
	});
});

describe("shu-artifact-frame cursor and navigation events", () => {
	it("requests that the column move the cursor on open (carrying itself for step resolution) but not on exit", async () => {
		const frame = await frameIn(stamped);
		const onCursorToRow = vi.fn();
		document.addEventListener(SHU_EVENT.CURSOR_TO_ROW, onCursorToRow);
		await toggleFullscreen(frame); // open
		expect(onCursorToRow).toHaveBeenCalledTimes(1);
		expect((itemAt(onCursorToRow.mock.calls, 0)[0] as CustomEvent).detail.row).toBe(frame); // the column reads its data-step-id
		await toggleFullscreen(frame); // exit, must not re-navigate
		expect(onCursorToRow).toHaveBeenCalledTimes(1);
		document.removeEventListener(SHU_EVENT.CURSOR_TO_ROW, onCursorToRow);
	});

	it("delegates fullscreen ←/→ to the column as FRAME_NAV (only the column can reach off-window frames)", async () => {
		const frame = await frameIn(stamped);
		const onNav = vi.fn();
		document.addEventListener(SHU_EVENT.FRAME_NAV, onNav);
		await toggleFullscreen(frame);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
		expect(onNav).toHaveBeenCalledTimes(2);
		expect((itemAt(onNav.mock.calls, 0)[0] as CustomEvent).detail).toEqual({ dir: 1, from: frame });
		expect((itemAt(onNav.mock.calls, 1)[0] as CustomEvent).detail).toEqual({ dir: -1, from: frame });
		document.removeEventListener(SHU_EVENT.FRAME_NAV, onNav);
	});

	it("ignores arrows while not fullscreen", async () => {
		await frameIn(stamped);
		const onNav = vi.fn();
		document.addEventListener(SHU_EVENT.FRAME_NAV, onNav);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
		expect(onNav).not.toHaveBeenCalled();
		document.removeEventListener(SHU_EVENT.FRAME_NAV, onNav);
	});
});

describe("shu-artifact-frame expanded over its column", () => {
	/** The document column's box on screen, beside other panes. */
	const COLUMN = { top: 40, left: 300, width: 500, height: 700 };
	/** A frame inside a column's shadow root, whose host is the column the frame expands over. */
	async function frameInColumn(): Promise<ShuArtifactFrame> {
		document.body.innerHTML = "<div></div>";
		const column = document.body.firstElementChild as HTMLElement;
		column.getBoundingClientRect = () => ({
			...COLUMN,
			right: COLUMN.left + COLUMN.width,
			bottom: COLUMN.top + COLUMN.height,
			x: COLUMN.left,
			y: COLUMN.top,
			toJSON: () => COLUMN,
		});
		const root = column.attachShadow({ mode: "open" });
		root.innerHTML = stamped;
		const frame = root.querySelector("shu-artifact-frame") as ShuArtifactFrame;
		await frame.updateComplete;
		return frame;
	}

	it("takes the column's whole box on screen, from its left edge", async () => {
		const frame = await frameInColumn();
		await toggleFullscreen(frame);
		expect(["--fs-top", "--fs-left", "--fs-width", "--fs-height"].map((v) => frame.style.getPropertyValue(v))).toEqual(
			[COLUMN.top, COLUMN.left, COLUMN.width, COLUMN.height].map((px) => `${px}px`),
		);
	});

	/** The element of the frame that enters the top layer, with its popover calls recorded. */
	const topLayerOf = (frame: ShuArtifactFrame) => {
		const shown = vi.fn();
		const hidden = vi.fn();
		const content = (frame.shadowRoot as ShadowRoot).querySelector(".frame") as HTMLElement;
		Object.assign(content, { showPopover: shown, hidePopover: hidden });
		return { content, shown, hidden };
	};

	it("shows its content in the top layer as a popover, which a later row's tiles don't paint over, and leaves it on exit", async () => {
		const frame = await frameInColumn();
		const { content, shown, hidden } = topLayerOf(frame);
		await toggleFullscreen(frame);
		expect([content.getAttribute("popover"), shown.mock.calls.length]).toEqual(["manual", 1]);
		await toggleFullscreen(frame);
		expect([content.hasAttribute("popover"), hidden.mock.calls.length]).toEqual([false, 1]);
	});

	it("keeps the height it had in its row while expanded, so the rows after it keep their places", async () => {
		const frame = await frameInColumn();
		frame.getBoundingClientRect = () => ({ top: 0, left: 0, right: 200, bottom: 125, x: 0, y: 0, width: 200, height: 125, toJSON: () => ({}) });
		await toggleFullscreen(frame);
		expect(frame.style.height).toBe("125px");
		await toggleFullscreen(frame);
		expect(frame.style.height).toBe("");
	});

	it("enters the top layer again where a virtualizer moves its row, which takes it out of the document", async () => {
		const frame = await frameInColumn();
		const { shown } = topLayerOf(frame);
		await toggleFullscreen(frame);
		(frame.parentElement as HTMLElement).append(frame);
		expect(shown.mock.calls.length).toBe(2);
	});
});

describe("a thumbnail's tile in the document", () => {
	/** The text of a component's styles, as the page adopts them. */
	const stylesOf = (styles: unknown): string =>
		[styles]
			.flat(Number.POSITIVE_INFINITY)
			.map((sheet) => (sheet as { cssText: string }).cssText)
			.join("\n");

	it("stretches to its grid track and its image fills it, rather than shrinking to the image", async () => {
		const { ShuArtifactFrame } = await import("./shu-artifact-frame.js");
		const styles = stylesOf(ShuArtifactFrame.styles);
		expect(styles).toMatch(/:host\(\.thumb\) \{ display: block;/);
		expect(styles).toMatch(/:host\(\.thumb:not\(\.fullscreen\)\) ::slotted\(img\) \{ display: block; width: 100%; aspect-ratio: 16 \/ 10;/);
	});

	it("is a track of the column's grid, at least a tile wide and never wider than the column", async () => {
		const { ShuDocumentColumn } = await import("./shu-document-column.js");
		expect(stylesOf(ShuDocumentColumn.styles)).toMatch(/\.thumb-row \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(min\(160px, 100%\), 1fr\)\);/);
	});
});
