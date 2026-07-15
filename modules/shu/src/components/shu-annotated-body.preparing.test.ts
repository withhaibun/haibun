// @vitest-environment jsdom
/**
 * Rendering a body inline blocks the thread — markdown, sanitizing, and anchoring all run synchronously, and lit paints
 * only once they return. A large body therefore renders behind a "preparing" indicator painted a frame earlier, in place
 * of the blank view a reader would otherwise sit in front of; a small body renders inline with no indicator to flash.
 *
 * jsdom does no layout, so this covers the lifecycle (what is shown, what is deferred, what is cancelled), not the
 * placement of highlights or cards — those need a real browser and are covered by the e2e suites.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuAnnotatedBody } from "./shu-annotated-body.js";

/** The annotator's spans renderer observes its container; jsdom ships no ResizeObserver. */
class StubResizeObserver {
	observe(): void {
		/* stub */
	}
	unobserve(): void {
		/* stub */
	}
	disconnect(): void {
		/* stub */
	}
}

const HEAVY = "a passage of prose. ".repeat(1200); // over the size that earns the indicator
const frames = (): Promise<void> => new Promise((r) => setTimeout(r, 80)); // past both deferred frames

const preparing = (el: ShuAnnotatedBody): boolean => !!el.querySelector('[data-testid="annotation-preparing"]');
const rendered = (el: ShuAnnotatedBody): string => el.querySelector('[data-testid="annotated-content"]')?.textContent ?? "";

const mount = (content: string): ShuAnnotatedBody => {
	const el = document.createElement("shu-annotated-body") as ShuAnnotatedBody;
	el.content = content;
	el.mediaType = "text/plain";
	el.sourceId = "f1";
	el.sourceLabel = "File";
	document.body.appendChild(el);
	return el;
};

describe("shu-annotated-body preparing indicator", () => {
	let el: ShuAnnotatedBody | undefined;
	beforeEach(() => {
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
		if (!customElements.get("shu-annotated-body")) customElements.define("shu-annotated-body", ShuAnnotatedBody);
	});
	afterEach(() => {
		el?.remove();
		el = undefined;
	});

	it("renders a small body inline at once, with no indicator to flash", async () => {
		el = mount("Anyone up for hiking this weekend?");
		await el.updateComplete;
		expect(preparing(el)).toBe(false);
		expect(rendered(el)).toContain("hiking this weekend");
	});

	it("shows the indicator in place of a blank view while a large body is still to render", async () => {
		el = mount(HEAVY);
		await el.updateComplete;
		expect(preparing(el)).toBe(true);
		expect(rendered(el)).toBe(""); // deferred: the blocking render has not run yet, so the indicator is what shows
	});

	it("replaces the indicator with the body once the deferred render runs", async () => {
		el = mount(HEAVY);
		await el.updateComplete;
		await frames();
		await el.updateComplete;
		expect(preparing(el)).toBe(false);
		expect(rendered(el)).toContain("a passage of prose");
	});

	it("cancels the deferred render when the body is taken off the page before it runs", async () => {
		el = mount(HEAVY);
		await el.updateComplete;
		const content = el.querySelector('[data-testid="annotated-content"]');
		el.remove();
		await frames();
		expect(content?.textContent).toBe(""); // never mounted onto content the reader is no longer looking at
	});
});
