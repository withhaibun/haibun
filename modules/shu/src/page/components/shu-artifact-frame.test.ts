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
	it("asks the column to move the cursor on open (carrying itself for step resolution) but not on exit", async () => {
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
