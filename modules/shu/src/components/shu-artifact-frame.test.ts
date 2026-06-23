// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "./shu-artifact-frame.js";

const STEP = "the import authority's signing identity is created";
const stepCaption = (frame: Element) => (frame.shadowRoot as ShadowRoot).querySelector(".step-caption")?.textContent;
const toggleFullscreen = (frame: Element) => (frame.shadowRoot as ShadowRoot).querySelector<HTMLButtonElement>(".fullscreen-btn")?.click();
const frameIn = (html: string) => {
	document.body.innerHTML = html;
	return document.body.querySelector("shu-artifact-frame") as Element;
};

describe("shu-artifact-frame fullscreen step caption", () => {
	it("shows the immediately-preceding step only while fullscreen, and clears it on exit", () => {
		const frame = frameIn(`
			<div class="log-row">${STEP}</div>
			<div class="feature-artifacts"><shu-artifact-frame class="thumb"><img src="x.png" /></shu-artifact-frame></div>`);
		expect(stepCaption(frame)).toBe(""); // not fullscreen
		toggleFullscreen(frame);
		expect(frame.classList.contains("fullscreen")).toBe(true);
		expect(stepCaption(frame)).toBe(STEP);
		toggleFullscreen(frame);
		expect(frame.classList.contains("fullscreen")).toBe(false);
		expect(stepCaption(frame)).toBe("");
	});

	it("uses the NEAREST preceding step, skipping intervening artifact containers", () => {
		const frame = frameIn(`
			<div class="log-row">first step</div>
			<div class="log-row">second step</div>
			<div class="feature-artifacts"><img src="a.png" /></div>
			<div class="feature-artifacts"><shu-artifact-frame class="thumb"><img src="b.png" /></shu-artifact-frame></div>`);
		toggleFullscreen(frame);
		expect(stepCaption(frame)).toBe("second step");
	});

	it("for grouped thumbnails, shows the step before the row", () => {
		document.body.innerHTML = `
			<div class="log-row">${STEP}</div>
			<div class="thumb-row">
				<div class="feature-artifacts"><shu-artifact-frame class="thumb"><img src="a.png" /></shu-artifact-frame></div>
				<div class="feature-artifacts"><shu-artifact-frame class="thumb"><img src="b.png" /></shu-artifact-frame></div>
			</div>`;
		for (const frame of Array.from(document.body.querySelectorAll("shu-artifact-frame"))) {
			toggleFullscreen(frame);
			expect(stepCaption(frame)).toBe(STEP);
			toggleFullscreen(frame);
		}
	});

	it("clicks the preceding step on open (the row sets the global time cursor) but not on exit", () => {
		const frame = frameIn(`
			<div class="log-row">${STEP}</div>
			<div class="feature-artifacts"><shu-artifact-frame class="thumb"><img src="x.png" /></shu-artifact-frame></div>`);
		const onStepClick = vi.fn();
		document.querySelector(".log-row")?.addEventListener("click", onStepClick);
		toggleFullscreen(frame); // open
		expect(onStepClick).toHaveBeenCalledTimes(1);
		toggleFullscreen(frame); // exit — must not re-navigate
		expect(onStepClick).toHaveBeenCalledTimes(1);
	});
});
