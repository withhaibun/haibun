// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "./shu-artifact-frame.js";
import { SHU_EVENT } from "../consts.js";

const STEP = "the import authority's signing identity is created";
const stepCaption = (frame: Element) => (frame.shadowRoot as ShadowRoot).querySelector(".step-caption")?.textContent;
const toggleFullscreen = (frame: Element) => (frame.shadowRoot as ShadowRoot).querySelector<HTMLButtonElement>(".fullscreen-btn")?.click();
// The document build (finalizeBlocks) stamps every thumbnail with its step; the frame reads only the stamp, under
// virtualization the step's block may not exist in the DOM, so nothing is derived from siblings.
const frameIn = (html: string) => {
	document.body.innerHTML = html;
	return document.body.querySelector("shu-artifact-frame") as Element;
};
const stamped = `<div class="thumb-row"><shu-artifact-frame class="thumb" data-step-id="0.1.2" data-step-label="${STEP}"><img src="x.png" /></shu-artifact-frame></div>`;

describe("shu-artifact-frame fullscreen step caption", () => {
	it("shows the stamped step only while fullscreen, and clears it on exit", () => {
		const frame = frameIn(stamped);
		expect(stepCaption(frame)).toBe(""); // not fullscreen
		toggleFullscreen(frame);
		expect(frame.classList.contains("fullscreen")).toBe(true);
		expect(stepCaption(frame)).toBe(STEP);
		toggleFullscreen(frame);
		expect(frame.classList.contains("fullscreen")).toBe(false);
		expect(stepCaption(frame)).toBe("");
	});

	it("shows no caption when the frame carries no stamp (an unstamped frame outside a document)", () => {
		const frame = frameIn(`<shu-artifact-frame class="thumb"><img src="x.png" /></shu-artifact-frame>`);
		toggleFullscreen(frame);
		expect(stepCaption(frame)).toBe("");
	});
});

describe("shu-artifact-frame cursor and navigation events", () => {
	it("asks the column to move the cursor on open (carrying itself for step resolution) but not on exit", () => {
		const frame = frameIn(stamped);
		const onCursorToRow = vi.fn();
		document.addEventListener(SHU_EVENT.CURSOR_TO_ROW, onCursorToRow);
		toggleFullscreen(frame); // open
		expect(onCursorToRow).toHaveBeenCalledTimes(1);
		expect((onCursorToRow.mock.calls[0][0] as CustomEvent).detail.row).toBe(frame); // the column reads its data-step-id
		toggleFullscreen(frame); // exit, must not re-navigate
		expect(onCursorToRow).toHaveBeenCalledTimes(1);
		document.removeEventListener(SHU_EVENT.CURSOR_TO_ROW, onCursorToRow);
	});

	it("delegates fullscreen ←/→ to the column as FRAME_NAV (only the column can reach off-window frames)", () => {
		const frame = frameIn(stamped);
		const onNav = vi.fn();
		document.addEventListener(SHU_EVENT.FRAME_NAV, onNav);
		toggleFullscreen(frame);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
		expect(onNav).toHaveBeenCalledTimes(2);
		expect((onNav.mock.calls[0][0] as CustomEvent).detail).toEqual({ dir: 1, from: frame });
		expect((onNav.mock.calls[1][0] as CustomEvent).detail).toEqual({ dir: -1, from: frame });
		document.removeEventListener(SHU_EVENT.FRAME_NAV, onNav);
	});

	it("ignores arrows while not fullscreen", () => {
		frameIn(stamped);
		const onNav = vi.fn();
		document.addEventListener(SHU_EVENT.FRAME_NAV, onNav);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
		expect(onNav).not.toHaveBeenCalled();
		document.removeEventListener(SHU_EVENT.FRAME_NAV, onNav);
	});
});
