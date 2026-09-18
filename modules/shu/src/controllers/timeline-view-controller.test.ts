// @vitest-environment jsdom
/**
 * A view's place on the run's timeline: it tracks the page's cursor until its reader holds a place of its own, and a
 * view that states a name writes the place it holds to the address.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TimelineViewController } from "./timeline-view-controller.js";
import { timeCursor } from "../signals.js";
import { getHash, mergeHashParams } from "../view-hash.js";

const PAST = 42;
const LATER = 77;

function mount(name?: string, onMove?: () => void) {
	const noop = (): void => undefined;
	const host = { addController: noop, removeController: noop, requestUpdate: noop, updateComplete: Promise.resolve(true) };
	const view = new TimelineViewController(host as never, { ...(name ? { name } : {}), ...(onMove ? { onMove } : {}) });
	view.hostConnected();
	return view;
}

describe("a view's place on the timeline", () => {
	beforeEach(() => {
		mergeHashParams({ ask: "" });
		timeCursor.set(null);
	});

	it("tracks the page's cursor, so scrubbing the run moves it", () => {
		const view = mount();
		expect(view.cursor).toBe(null);
		expect(view.atLiveEdge).toBe(true);
		timeCursor.set(PAST);
		expect(view.cursor, "the page's cursor is the view's").toBe(PAST);
		expect(view.atLiveEdge).toBe(false);
	});

	it("holds its own place once its reader states one, and the page moving leaves it there", () => {
		const view = mount();
		timeCursor.set(PAST);
		view.hold(view.cursor);
		expect(view.tracking).toBe(false);
		timeCursor.set(LATER);
		expect(view.cursor, "the place the reader held").toBe(PAST);
		view.track();
		expect(view.cursor, "and the page's again once they return to the live edge").toBe(LATER);
	});

	it("tells its host the page's cursor moved only while it tracks, so playing a run leaves a held view alone", () => {
		let moves = 0;
		const view = mount(undefined, () => {
			moves += 1;
		});
		timeCursor.set(PAST);
		expect(moves, "a tracking view moves with the page").toBe(1);
		view.hold(view.cursor);
		const held = moves;
		timeCursor.set(LATER);
		timeCursor.set(PAST);
		expect(moves, "and a view holding its own place doesn't").toBe(held);
	});

	it("shows every record made at or before the place it holds, and all of them at the live edge", () => {
		const view = mount();
		expect(view.shows(LATER), "at the live edge a view shows what arrives").toBe(true);
		view.hold(PAST);
		expect(view.shows(PAST)).toBe(true);
		expect(view.shows(LATER), "a record made after the reader's place isn't shown").toBe(false);
	});

	it("writes the place it holds to the address under the name it states, and takes it off at the live edge", () => {
		const view = mount("ask");
		view.hold(PAST);
		expect(getHash(), "a reload opens the view where the reader was reading").toContain(`ask=${PAST}`);
		view.track();
		expect(getHash(), "and the page's cursor is the page's to state").not.toContain("ask=");
	});

	it("reads the place the address states, so a reload opens where the reader was", () => {
		mergeHashParams({ ask: String(PAST) });
		const view = mount("ask");
		expect(view.tracking).toBe(false);
		expect(view.cursor).toBe(PAST);
	});

	it("states nothing in the address where it names none", () => {
		const view = mount();
		view.hold(PAST);
		expect(getHash()).not.toContain(String(PAST));
	});
});
