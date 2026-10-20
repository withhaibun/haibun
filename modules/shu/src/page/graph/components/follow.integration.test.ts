/**
 * Following, held to one rule in a real browser: while follow is on, the current subject's node is inside the canvas
 * and clear of whatever covers it, at the zoom the reader set. The rule is asserted after each way the node can leave
 * the view, since each reaches the scene by a different path and a rule stated per path is what let one path go
 * unstated. A reader's own zoom is theirs: following restores the view around it and never changes it. The reader pans
 * with a drag and zooms with the wheel, as on the page, and the zoom is read as how many pixels a world unit at the
 * followed node spans.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { BOX, mountPolymorphicPage, quadsNamed, type TMountedPage } from "../../../test/polymorphic-page.js";

const NODES = Array.from({ length: 144 }, (_, i) => `n-${i}`);
const QUADS = quadsNamed(NODES);
const FOLLOWED = "n-100";
/** A pan of most of the view's width takes its centre off it. */
const OFF_THE_VIEW_PX = BOX.width * 0.9;
/** A turn of the wheel that brings the camera four times closer. */
const ZOOM_IN_WHEEL = -2700;
/** The decimal places two reads of the zoom, in pixels per world unit, share to count as the same zoom. */
const SAME_ZOOM = 2;

let mounted: TMountedPage;

beforeAll(async () => {
	mounted = await mountPolymorphicPage();
	await mounted.feed(QUADS);
}, 90_000);

afterAll(() => mounted?.close());

/** Follow the node from a known framing: the whole graph fitted, so the zoom is the same for every route; the selection
 *  cleared, since re-asserting the same node leaves the camera where the reader put it; then following on, the node
 *  selected and centred, and the layout at rest. */
async function following(id = FOLLOWED): Promise<void> {
	await mounted.scene((scene) => {
		scene.setSelectedSubject(null);
		scene.fitGraph();
	});
	await mounted.atRest();
	await mounted.scene((scene) => scene.setConfig({ follow: true }));
	await mounted.select(id);
	await mounted.atRest();
}

/** Pan the view left by `px`, pressing on empty space on its right, as a reader drags it. */
async function panLeft(px: number): Promise<void> {
	await mounted.drag(await mounted.emptyPixel("right"), -px);
	await mounted.atRest();
}

/** Whether the node draws inside the central half of the view, which is the position following guarantees. */
async function centred(id: string): Promise<{ at: { x: number; y: number }; centred: boolean }> {
	const at = await mounted.projection(id);
	const box = await mounted.box();
	return { at, centred: Math.abs(at.x - (box.x + box.w / 2)) < box.w / 4 && Math.abs(at.y - (box.y + box.h / 2)) < box.h / 4 };
}

test("a record another view states is centred while the graph follows", { timeout: 60_000 }, async () => {
	// The selection arrives from outside the scene here, which is the path a click on the canvas never takes: the click
	// centres the node itself, so its behaviour doesn't show whether a record stated by a column, a pane or a conversation is
	// followed.
	await following();
	expect(mounted.errors(), "page errors").toEqual([]);
	expect((await centred(FOLLOWED)).centred, "the stated record draws within the central half of the view").toBe(true);
});

test("a pan that takes the followed node off the view is followed by its return, at the same zoom", { timeout: 60_000 }, async () => {
	await following();
	const zoom = await mounted.zoomAt(FOLLOWED);
	await panLeft(OFF_THE_VIEW_PX);
	const back = await centred(FOLLOWED);
	expect(back.centred, `the node came back into view at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
	expect(await mounted.zoomAt(FOLLOWED), "the reader's zoom is untouched").toBeCloseTo(zoom, SAME_ZOOM);
});

test("a pan that leaves the node on the view is left alone", { timeout: 60_000 }, async () => {
	// Following moves the camera only to restore the rule: a reader who pans the node toward an edge,
	// still in view, has put it where they want it.
	await following();
	const centre = await mounted.projection(FOLLOWED);
	await panLeft(200);
	const moved = await mounted.projection(FOLLOWED);
	expect(centre.x - moved.x, `following left it where the pan put it, at (${moved.x.toFixed(0)},${moved.y.toFixed(0)})`).toBeGreaterThan(150);
});

test("a zoom that pushes the node out is followed by its return, at the zoom the reader chose", { timeout: 60_000 }, async () => {
	await following();
	// Off-centre first, so zooming in on the view's middle carries the node outward and off the view.
	await panLeft(300);
	const before = await mounted.zoomAt(FOLLOWED);
	await mounted.wheel(ZOOM_IN_WHEEL);
	const back = await centred(FOLLOWED);
	expect(back.centred, `the node came back into view at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
	// A pan doesn't change the zoom, so following's return leaves the wheel's four times closer.
	expect((await mounted.zoomAt(FOLLOWED)) / before, "at the zoom the reader chose, not the one before").toBeCloseTo(4, 0);
});

test("a view narrowed until the node falls off it is followed by its return", { timeout: 60_000 }, async () => {
	await following();
	await panLeft(350);
	const zoom = await mounted.zoomAt(FOLLOWED);
	await mounted.page.evaluate(() => {
		(document.querySelector("#box") as HTMLElement).style.width = "320px";
	});
	try {
		const back = await centred(FOLLOWED);
		expect(back.centred, `the node came back into the narrowed view at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
		expect(await mounted.zoomAt(FOLLOWED), "a resize does not change the zoom").toBeCloseTo(zoom, SAME_ZOOM);
	} finally {
		await mounted.page.evaluate((w) => {
			(document.querySelector("#box") as HTMLElement).style.width = `${w}px`;
		}, BOX.width);
		await mounted.atRest();
	}
});

test("a layout that moves the followed node, from records arriving, is followed by its return", { timeout: 90_000 }, async () => {
	await following();
	const zoom = await mounted.zoomAt(FOLLOWED);
	// Twice the nodes: the force layout spreads again, and the followed node lands somewhere new.
	await mounted.feed([...QUADS, ...quadsNamed(Array.from({ length: 144 }, (_, i) => `n-${200 + i}`))]);
	const back = await centred(FOLLOWED);
	expect(back.centred, `the node is in view after the layout at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
	expect(await mounted.zoomAt(FOLLOWED), "records arriving do not change the zoom").toBeCloseTo(zoom, SAME_ZOOM);
	await mounted.feed(QUADS);
});

test("a record chosen before the graph holds it is centred once it arrives", { timeout: 90_000 }, async () => {
	// The conversation selects a question before the graph lays it out. The layout that adds the record centres it.
	await mounted.scene((scene) => scene.setConfig({ follow: true }));
	await mounted.scene((scene) => scene.setSelectedSubject("n-900"));
	await mounted.feed([...QUADS, ...quadsNamed(["n-900"])]);
	const back = await centred("n-900");
	expect(mounted.errors(), "page errors").toEqual([]);
	expect(back.centred, `the late record is in view at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
	await mounted.feed(QUADS);
});

test("a panel over the view aims the followed record clear of it, and closing the panel brings it back to the centre", { timeout: 60_000 }, async () => {
	// An overlay declares data-covers-views while it covers the views. A framing aims into the uncovered region, and
	// aims at the whole view again when the declaration is removed. Any panel that declares the attribute gets this.
	const COVER_TOP = 250;
	await mounted.page.evaluate((top) => {
		const panel = document.createElement("div");
		panel.id = "cover";
		panel.style.cssText = `position:fixed;left:0;right:0;top:${top}px;bottom:0;background:#000`;
		document.body.appendChild(panel);
	}, COVER_TOP);
	await following();
	await mounted.page.evaluate(() => (document.querySelector("#cover") as HTMLElement).setAttribute("data-covers-views", ""));
	const covered = await mounted.projection(FOLLOWED);
	expect(covered.y, "the followed record draws above the panel, where its reader can see it").toBeLessThan(COVER_TOP);

	await mounted.page.evaluate(() => (document.querySelector("#cover") as HTMLElement).removeAttribute("data-covers-views"));
	const uncovered = await centred(FOLLOWED);
	expect(mounted.errors(), "page errors").toEqual([]);
	expect(uncovered.centred, "and back to the middle of the view once an overlay doesn't cover it").toBe(true);
	await mounted.page.evaluate(() => document.querySelector("#cover")?.remove());
});

test("a click on the followed record opens it when the same click uncovers the view", { timeout: 60_000 }, async () => {
	// The actions bar closes on a click elsewhere on the page. Removing the cover re-aims the followed record before the
	// canvas click listener runs. The scene opens the node picked at the press, so the camera move does not change it.
	const COVER_TOP = 250;
	await mounted.page.evaluate((top) => {
		const panel = document.createElement("div");
		panel.id = "cover";
		panel.style.cssText = `position:fixed;left:0;right:0;top:${top}px;bottom:0;background:#000`;
		document.body.appendChild(panel);
		document.addEventListener("click", () => panel.removeAttribute("data-covers-views"), { capture: true, once: true });
	}, COVER_TOP);
	await following();
	await mounted.page.evaluate(() => (document.querySelector("#cover") as HTMLElement).setAttribute("data-covers-views", ""));
	const pressed = await mounted.projection(FOLLOWED);
	expect(pressed.y, "the followed record is aimed above the panel").toBeLessThan(COVER_TOP);
	expect(await mounted.click(pressed), "the record the reader pressed on is the one opened (null: the click didn't open a node)").toBe(FOLLOWED);
	expect(mounted.errors(), "page errors").toEqual([]);
	await mounted.page.evaluate(() => document.querySelector("#cover")?.remove());
});

test("a click on empty space makes the page's entry empty, so a record isn't active", { timeout: 60_000 }, async () => {
	// Empty space is the reader choosing an empty entry on the page: the scene activates an empty entry in the page scope, and
	// the views that read the active record receive the news that a record isn't active.
	await following();
	expect(await mounted.click(await mounted.emptyPixel("left")), "the click didn't open a node").toBeNull();
	const state = await mounted.subjectState();
	expect(state.scopes.page?.entry.record, "the page's entry doesn't name a record").toBeNull();
	expect(state.scopes.page?.entry.bundle.patterns).toEqual([]);
});
