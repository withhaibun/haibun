// @vitest-environment jsdom
/**
 * A view follows the page's time cursor through its `TimelineViewController`. A move of the cursor by one view reaches
 * every other view that tracks it, and a view opened at a moment (`data-snapshot-time`) shows that moment and doesn't
 * follow or move the page's cursor.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "../components/shu-element.js";
import { timeCursor } from "../root.js";
import { SHU_ATTR } from "../../domains/elements.js";
import { TimelineViewController } from "./timeline-view-controller.js";

const S = z.object({ n: z.number() });

class TimeProbe extends ShuElement<typeof S> {
	summarizeForKihan() {
		return null;
	}

	moves: (number | null)[] = [];
	readonly timeline = new TimelineViewController(this, { onMove: (cursor) => this.moves.push(cursor) });
	constructor() {
		super(S, { n: 0 });
	}
	render(): TemplateResult {
		return html`<span>${this.timeline.cursor === null ? "none" : this.timeline.cursor}</span>`;
	}
}
customElements.define("time-probe", TimeProbe);

const mounted = async (pinnedAt?: string): Promise<TimeProbe> => {
	const el = document.createElement("time-probe") as TimeProbe;
	if (pinnedAt !== undefined) el.setAttribute(SHU_ATTR.SNAPSHOT_TIME, pinnedAt);
	document.body.appendChild(el);
	await el.updateComplete;
	return el;
};

describe("a view's place on the page's time cursor", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		timeCursor.set(null);
	});

	it("moves with the page's cursor, which one view moves for every view that tracks it", async () => {
		const [a, b] = [await mounted(), await mounted()];
		a.timeline.movePage(456);
		await b.updateComplete;
		expect(b.moves).toEqual([456]);
		expect(b.timeline.cursor).toBe(456);
		expect(b.shadowRoot?.textContent).toBe("456");
	});

	it("dims a record after the cursor and shows the records at or before it", async () => {
		const view = await mounted();
		view.timeline.movePage(100);
		expect(view.timeline.isFuture(101)).toBe(true);
		expect(view.timeline.isFuture(100)).toBe(false);
		expect(view.timeline.shownBy([{ timestamp: 99 }, { timestamp: 100 }, { timestamp: 101 }])).toEqual([{ timestamp: 99 }, { timestamp: 100 }]);
	});

	it("shows the moment a view is opened at, and doesn't follow or move the page's cursor", async () => {
		const [pinned, live] = [await mounted("999"), await mounted()];
		expect(pinned.timeline.cursor).toBe(999);
		live.timeline.movePage(123);
		pinned.timeline.movePage(5);
		expect(pinned.moves).toEqual([]);
		expect(pinned.timeline.cursor).toBe(999);
		expect(timeCursor.get(), "the pinned view doesn't move the page's cursor").toBe(123);
	});
});
