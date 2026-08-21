// @vitest-environment jsdom
/**
 * shu-scrollbar interaction that does not need layout: the emit clamp (a marker or wheel can never over-scroll past the
 * last window), wheel paging, and event routing (a marker press seeks once, not also the rail). Thumb/rail drag needs
 * getBoundingClientRect and pointer capture, so it is covered in the browser e2e.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ShuScrollbar, SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import { markerTopPx, thumbHeightPx, type TScrollMarker, type TWindow } from "../scrollbar-model.js";

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

const pointerdown = (target: Element, clientY = 0): void => {
	target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 1, clientY }));
};

/** jsdom lays nothing out, so a rail measures 0 and every press maps to row 0. State its box, and the press path — which
 *  is all geometry — can be driven here rather than only in a browser. */
function railBox(el: ShuScrollbar, top: number, height: number): void {
	const rail = el.shadowRoot?.querySelector('[data-testid="scrollbar-rail"]');
	if (!rail) throw new Error("no rail rendered to measure");
	Object.defineProperty(rail, "getBoundingClientRect", { configurable: true, value: () => ({ top, height, bottom: top + height, left: 0, right: 32, width: 32, x: 0, y: top }) });
}

describe("shu-scrollbar interaction", () => {
	beforeAll(() => {
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
		if (!customElements.get("shu-scrollbar")) customElements.define("shu-scrollbar", ShuScrollbar);
	});

	it("a press on a marker past the last window says that row, which no window begins", async () => {
		const RAIL = 200;
		const { el, seeks } = await mount(1000, { first: 990, visible: 20 }, [{ index: 999, id: "z", icon: "📝", color: "#000" }]);
		railBox(el, 0, RAIL);
		expect(el.shadowRoot?.querySelector("[data-testid=scrollbar-marker]"), "the mark is drawn").toBeTruthy();
		// Pressed where that mark sits on a rail of this height. The mark does not take the press itself — the rail does,
		// and says which ROW was picked. Row 999 begins no window (the last starts at 980), and saying 980 instead would
		// mean the last twenty rows could never be pointed at.
		const at = markerTopPx(999, 1000, RAIL, thumbHeightPx(20 / 1000, RAIL));
		pointerdown(el.shadowRoot?.querySelector("[data-testid=scrollbar-rail]") as Element, at);
		expect(seeks).toEqual([999]);
	});

	it("never says a row the log does not have", async () => {
		const RAIL = 200;
		const { el, seeks } = await mount(1000, { first: 0, visible: 20 });
		railBox(el, 0, RAIL);
		const rail = el.shadowRoot?.querySelector("[data-testid=scrollbar-rail]") as Element;
		pointerdown(rail, RAIL + 500); // far below the rail's foot
		pointerdown(rail, -500); // and far above its head
		expect(seeks, "held to the rows there are").toEqual([999, 0]);
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

describe("showing which moment is being shown", () => {
	// The thumb says what is ON SCREEN; the cursor says WHEN. They are different questions, so the rail answers them
	// with different marks — and the cursor is drawn on the same scale as the event marks, so it lines up with the one
	// it is sitting on rather than being a few pixels off it.
	const cursorEl = (el: ShuScrollbar) => el.shadowRoot?.querySelector('[data-testid="scrollbar-cursor"]') as HTMLElement | null;

	it("shows nothing when no moment is pinned, since every view is then showing now", async () => {
		const { el } = await mount(100, { first: 0, visible: 10 });
		expect(cursorEl(el)).toBeNull();
	});

	it("marks the moment once one is pinned", async () => {
		const { el } = await mount(100, { first: 0, visible: 10 });
		el.cursor = 50;
		await el.updateComplete;
		expect(cursorEl(el)).toBeTruthy();
	});

	it("takes it away again when the moment is released", async () => {
		const { el } = await mount(100, { first: 0, visible: 10 });
		el.cursor = 50;
		await el.updateComplete;
		el.cursor = -1;
		await el.updateComplete;
		expect(cursorEl(el), "back to showing now, so there is no moment to mark").toBeNull();
	});

	// WHERE it lands needs a laid-out rail, which this environment has none of: every position would read 0 and the
	// assertion would pass whatever the code did. It is drawn by markerTopPx, the same call and the same arguments the
	// event marks use, so it is on their scale by construction — see scrollbar-model's own tests for that geometry.
});

describe("before anything has reported what is on screen", () => {
	// A thumb needs a viewport to be about. With none reported yet the height clamps to its minimum and sits at the top,
	// which reads as "you are at the start, looking at very little" — a claim about the reader made before anything knows
	// it, and the grey box that used to appear on load until the first window arrived.
	const thumb = (el: ShuScrollbar) => el.shadowRoot?.querySelector('[data-testid="scrollbar-thumb"]');

	it("draws no thumb", async () => {
		const { el } = await mount(500, { first: 0, visible: 0 });
		expect(thumb(el)).toBeNull();
	});

	it("draws one as soon as a window is reported", async () => {
		const { el } = await mount(500, { first: 0, visible: 0 });
		el.window = { first: 0, visible: 40 };
		await el.updateComplete;
		expect(thumb(el)).toBeTruthy();
	});

	it("still marks the events, which are known whether or not anything is on screen", async () => {
		const marks: TScrollMarker[] = [{ index: 10, id: "m", icon: "x", color: "#fff" }];
		const { el } = await mount(500, { first: 0, visible: 0 }, marks);
		expect(el.shadowRoot?.querySelectorAll('[data-testid="scrollbar-marker"]').length).toBe(1);
	});
});

describe("aiming at the rail", () => {
	// The whole width of the control is the target — a 14px track asks for a precision nobody should need, least of all
	// in a collapsed column where the rail is the only control there is. The widths themselves are CSS, which this
	// environment does not apply to a shadow root, so they are checked in the browser; what is structural is that the
	// drawn band is its OWN element, so the target can be widened without widening what is drawn.
	it("takes a press on the target and seeks from it", async () => {
		const { el, seeks } = await mount(100, { first: 0, visible: 10 });
		const rail = el.shadowRoot?.querySelector('[data-testid="scrollbar-rail"]') as HTMLElement | null;
		if (!rail) throw new Error("no rail rendered");
		pointerdown(rail);
		expect(seeks.length).toBe(1);
	});

	it("draws the track as its own element, separate from the target that takes the press", async () => {
		const { el } = await mount(100, { first: 0, visible: 10 });
		const rail = el.shadowRoot?.querySelector('[data-testid="scrollbar-rail"]');
		const track = el.shadowRoot?.querySelector(".track");
		expect(track, "the visible band").toBeTruthy();
		expect(track?.parentElement, "drawn inside the target, not instead of it").toBe(rail);
	});
});

describe("a press on the thumb that never moves", () => {
	// A press the pointer never carries anywhere is a click, and a click goes to where it landed. That is a tap on a
	// touch screen, and it is what a click on anything the thumb happens to be covering has to do — the thumb sits above
	// the marks, so without this a click on a covered mark does nothing at all.
	const press = (el: ShuScrollbar) => {
		const thumb = el.shadowRoot?.querySelector('[data-testid="scrollbar-thumb"]');
		if (!thumb) throw new Error("no thumb rendered to press");
		thumb.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 1, clientY: 40 }));
	};
	const release = () => document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientY: 40 }));

	it("seeks to where it landed", async () => {
		const { el, seeks } = await mount(100, { first: 0, visible: 10 });
		press(el);
		expect(seeks, "nothing yet — a press alone might still become a drag").toEqual([]);
		release();
		expect(seeks.length, "released without moving, so it was a click").toBe(1);
	});

	it("does not seek again when the press was carried, since the drag already did", async () => {
		const { el, seeks } = await mount(100, { first: 0, visible: 10 });
		press(el);
		document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY: 90 }));
		const during = seeks.length;
		expect(during, "the move seeks").toBeGreaterThan(0);
		release();
		expect(seeks.length, "and the release adds nothing on top of it").toBe(during);
	});
});
