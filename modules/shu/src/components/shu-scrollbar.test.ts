// @vitest-environment jsdom
/**
 * shu-scrollbar interaction that does not need layout: the emit clamp (a marker or wheel can never over-scroll past the
 * last window), wheel paging, and event routing (a marker press seeks once, not also the rail). Thumb/rail drag needs
 * getBoundingClientRect and pointer capture, so it is covered in the browser e2e.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ShuScrollbar, SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import type { TScrollMarker, TWindow } from "../scrollbar-model.js";

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

async function mount(total: number, window: TWindow, markers: TScrollMarker[] = []): Promise<{ el: ShuScrollbar; seeks: number[] }> {
	const el = document.createElement("shu-scrollbar") as ShuScrollbar;
	el.total = total;
	el.window = window;
	el.markers = markers;
	const seeks: number[] = [];
	el.addEventListener(SCROLL_TO_INDEX, (e) => seeks.push((e as CustomEvent<{ index: number }>).detail.index));
	document.body.appendChild(el);
	await el.updateComplete;
	return { el, seeks };
}

const pointerdown = (target: Element): void => {
	target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
};

describe("shu-scrollbar interaction", () => {
	beforeAll(() => {
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
		if (!customElements.get("shu-scrollbar")) customElements.define("shu-scrollbar", ShuScrollbar);
	});

	it("a marker past the last window seeks only to total-visible, never over-scrolling", async () => {
		const { el, seeks } = await mount(1000, { first: 990, visible: 20 }, [{ index: 999, id: "z", icon: "📝", color: "#000" }]);
		const marker = el.shadowRoot?.querySelector("[data-testid=scrollbar-marker]");
		expect(marker).toBeTruthy();
		pointerdown(marker as Element);
		expect(seeks).toEqual([980]); // clamped to 1000 - 20
	});

	it("showPosition=false hides the ordinal/total readout but keeps the marks", async () => {
		const el = document.createElement("shu-scrollbar") as ShuScrollbar;
		el.total = 1000;
		el.window = { first: 100, visible: 20 };
		el.markers = [{ index: 500, id: "m", icon: "📝", color: "#000" }];
		el.showPosition = false;
		document.body.appendChild(el);
		await el.updateComplete;
		expect((el.shadowRoot?.querySelector("[data-testid=scrollbar-pos-top]")?.textContent ?? "").trim()).toBe("");
		expect((el.shadowRoot?.querySelector("[data-testid=scrollbar-pos-bottom]")?.textContent ?? "").trim()).toBe("");
		expect(el.shadowRoot?.querySelector("[data-testid=scrollbar-marker]")).toBeTruthy(); // marks stay
	});

	it("a wheel notch pages half a window each way", async () => {
		const { el, seeks } = await mount(1000, { first: 100, visible: 20 }, []);
		const rail = el.shadowRoot?.querySelector(".rail") as HTMLElement;
		rail.dispatchEvent(Object.assign(new Event("wheel", { bubbles: true }), { deltaY: 1 }));
		rail.dispatchEvent(Object.assign(new Event("wheel", { bubbles: true }), { deltaY: -1 }));
		expect(seeks).toEqual([110, 90]);
	});

	it("a negative wheel past the top clamps to zero", async () => {
		const { el, seeks } = await mount(1000, { first: 5, visible: 20 }, []);
		const rail = el.shadowRoot?.querySelector(".rail") as HTMLElement;
		rail.dispatchEvent(Object.assign(new Event("wheel", { bubbles: true }), { deltaY: -1 }));
		expect(seeks).toEqual([0]); // 5 - 10 clamps to 0
	});

	it("pressing a marker seeks exactly once: the rail seek is not also invoked (stopPropagation)", async () => {
		const { el, seeks } = await mount(1000, { first: 0, visible: 20 }, [{ index: 500, id: "m", icon: "📝", color: "#000" }]);
		const marker = el.shadowRoot?.querySelector("[data-testid=scrollbar-marker]") as Element;
		pointerdown(marker);
		expect(seeks).toHaveLength(1);
	});
});
