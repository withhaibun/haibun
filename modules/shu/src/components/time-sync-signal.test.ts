// @vitest-environment jsdom
/**
 * Contract for signal-driven time sync (replaces the old SHU_EVENT.TIME_SYNC bus).
 *
 * Setting `this.timeCursor` on one live view publishes app-wide over the cross-bundle cursor bus; every live view that
 * overrides `onTimeSync` re-runs it, and any view reading `this.timeCursor` in render auto-rerenders. Snapshot-pinned
 * views (`data-snapshot-time`) replay a fixed point and opt out of the live cursor.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { timeCursor } from "../signals.js";

const S = z.object({ n: z.number().default(0) });

class LiveTimeProbe extends ShuElement<typeof S> {
	calls: (number | null)[] = [];
	constructor() {
		super(S, { n: 0 });
	}
	render(): TemplateResult {
		return html`<span>${this.timeCursor ?? "none"}</span>`;
	}
	protected onTimeSync(cursor: number | null): void {
		this.calls.push(cursor);
	}
}
customElements.define("live-time-probe", LiveTimeProbe);

class PinnedTimeProbe extends ShuElement<typeof S> {
	calls: (number | null)[] = [];
	constructor() {
		super(S, { n: 0 });
	}
	render(): TemplateResult {
		return html`<span></span>`;
	}
	protected onTimeSync(cursor: number | null): void {
		this.calls.push(cursor);
	}
}
customElements.define("pinned-time-probe", PinnedTimeProbe);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const cursorOf = (el: ShuElement<typeof S>): number | null => (el as unknown as { timeCursor: number | null }).timeCursor;

describe("signal-driven time sync", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		timeCursor.set(null);
	});

	it("a cursor change runs onTimeSync on live views and updates this.timeCursor", async () => {
		const el = document.createElement("live-time-probe") as LiveTimeProbe;
		document.body.appendChild(el);
		await el.updateComplete;
		await flush();
		el.calls.length = 0;
		(el as unknown as { timeCursor: number | null }).timeCursor = 123;
		await flush();
		expect(el.calls).toContain(123);
		expect(cursorOf(el)).toBe(123);
	});

	it("setting timeCursor on one live view publishes to another via the signal", async () => {
		const a = document.createElement("live-time-probe") as LiveTimeProbe;
		const b = document.createElement("live-time-probe") as LiveTimeProbe;
		document.body.append(a, b);
		await a.updateComplete;
		await b.updateComplete;
		await flush();
		b.calls.length = 0;
		(a as unknown as { timeCursor: number | null }).timeCursor = 456;
		await flush();
		expect(b.calls).toContain(456);
		expect(cursorOf(b)).toBe(456);
	});

	it("snapshot-pinned views replay their own cursor and ignore the global signal", async () => {
		const pinned = document.createElement("pinned-time-probe") as PinnedTimeProbe;
		pinned.setAttribute("data-snapshot-time", "999");
		const live = document.createElement("live-time-probe") as LiveTimeProbe;
		document.body.append(pinned, live);
		await pinned.updateComplete;
		await live.updateComplete;
		await flush();
		expect(cursorOf(pinned)).toBe(999);
		pinned.calls.length = 0;
		(live as unknown as { timeCursor: number | null }).timeCursor = 123;
		await flush();
		expect(pinned.calls).toEqual([]);
		expect(cursorOf(pinned)).toBe(999);
	});
});
