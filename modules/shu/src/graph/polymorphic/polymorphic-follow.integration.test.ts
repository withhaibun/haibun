/**
 * Following, held to one rule in a real browser: while follow is on, the current subject's node is inside the canvas
 * and clear of whatever covers it, at the zoom the reader set. The rule is asserted after each way the node can leave
 * the view, since each reaches the scene by a different path and a rule stated per path is what let one path go
 * unstated. A reader's own zoom is theirs: following restores the view around it and never changes it.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { BOX, mountPolymorphicPage, quadsNamed, type TMountedPage } from "./polymorphic-page.test-fake.js";

const NODES = Array.from({ length: 144 }, (_, i) => `n-${i}`);
const QUADS = quadsNamed(NODES);
const FOLLOWED = "n-100";
/** A pan of more than the view is wide takes any node off it. */
const OFF_THE_VIEW_PX = BOX.width + 200;

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
	await mounted.settle();
	await mounted.scene((scene) => scene.setConfig({ follow: true }));
	await mounted.select(id);
	await mounted.projection(id);
	await mounted.settle();
}

/** Whether the node draws inside the central half of the view, which is what following promises. */
async function centred(id: string): Promise<{ at: { x: number; y: number }; centred: boolean }> {
	const at = await mounted.projection(id);
	const box = await mounted.box();
	return { at, centred: Math.abs(at.x - (box.x + box.w / 2)) < box.w / 4 && Math.abs(at.y - (box.y + box.h / 2)) < box.h / 4 };
}

test("a record another view states is centred while the graph follows", { timeout: 60_000 }, async () => {
	// The selection arrives from outside the scene here, which is the path a click on the canvas never takes: the click
	// centres the node itself, so nothing it does says whether a record stated by a column, a pane or a conversation is
	// followed.
	await following();
	expect(mounted.errors(), "page errors").toEqual([]);
	expect((await centred(FOLLOWED)).centred, "the stated record draws within the central half of the view").toBe(true);
});

test("a pan that takes the followed node off the view is followed by its return, at the same zoom", { timeout: 60_000 }, async () => {
	await following();
	const zoom = await mounted.distance();
	await mounted.scene((scene, px: number) => scene.panBy(px, "pixels", "left"), OFF_THE_VIEW_PX);
	const back = await centred(FOLLOWED);
	expect(back.centred, `the node came back into view at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
	expect(await mounted.distance(), "the reader's zoom is untouched").toBeCloseTo(zoom, 3);
});

test("a pan that leaves the node on the view is left alone", { timeout: 60_000 }, async () => {
	// Following moves the camera to restore the rule and at no other time: a reader who pans the node toward an edge,
	// still in view, has put it where they want it.
	await following();
	await mounted.scene((scene) => scene.panBy(200, "pixels", "left"));
	const moved = await mounted.projection(FOLLOWED);
	await mounted.page.waitForTimeout(600); // longer than the camera rest a re-aim waits for
	const later = await mounted.projection(FOLLOWED);
	expect(Math.abs(later.x - moved.x) + Math.abs(later.y - moved.y), "nothing moved it back").toBeLessThan(2);
});

test("a zoom that pushes the node out is followed by its return, at the zoom the reader chose", { timeout: 60_000 }, async () => {
	await following();
	// Off-centre first, so zooming in on the view's middle carries the node outward and off the view.
	await mounted.scene((scene) => scene.panBy(300, "pixels", "left"));
	await mounted.projection(FOLLOWED);
	await mounted.page.waitForTimeout(600);
	const chosen = await mounted.scene((scene) => {
		scene.zoomBy(75, "percent", "in");
		const c = scene.inspect().camera;
		if (!c) throw new Error("no camera after the zoom");
		return Math.hypot(c.x - c.target.x, c.y - c.target.y, c.z - c.target.z);
	});
	const back = await centred(FOLLOWED);
	expect(back.centred, `the node came back into view at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
	expect(await mounted.distance(), "at the distance the reader zoomed to, not the one before").toBeCloseTo(chosen, 3);
});

test("a view narrowed until the node falls off it is followed by its return", { timeout: 60_000 }, async () => {
	await following();
	await mounted.scene((scene) => scene.panBy(350, "pixels", "left"));
	await mounted.projection(FOLLOWED);
	await mounted.page.waitForTimeout(600);
	const zoom = await mounted.distance();
	await mounted.page.evaluate(() => {
		(document.querySelector("#box") as HTMLElement).style.width = "320px";
	});
	try {
		const back = await centred(FOLLOWED);
		expect(back.centred, `the node came back into the narrowed view at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
		expect(await mounted.distance(), "a resize does not change the zoom").toBeCloseTo(zoom, 3);
	} finally {
		await mounted.page.evaluate((w) => {
			(document.querySelector("#box") as HTMLElement).style.width = `${w}px`;
		}, BOX.width);
		await mounted.settle();
	}
});

test("a layout that moves the followed node, from records arriving, is followed by its return", { timeout: 90_000 }, async () => {
	await following();
	const zoom = await mounted.distance();
	// Twice the nodes: the force layout spreads again, and the followed node lands somewhere new.
	await mounted.feed([...QUADS, ...quadsNamed(Array.from({ length: 144 }, (_, i) => `n-${200 + i}`))]);
	const back = await centred(FOLLOWED);
	expect(back.centred, `the node is in view after the layout at (${back.at.x.toFixed(0)},${back.at.y.toFixed(0)})`).toBe(true);
	expect(await mounted.distance(), "records arriving do not change the zoom").toBeCloseTo(zoom, 3);
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
	expect(uncovered.centred, "and back to the middle of the view once nothing covers it").toBe(true);
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
	expect(await mounted.click(pressed), "the record the reader pressed on is the one opened (null: the click opened nothing)").toBe(FOLLOWED);
	expect(mounted.errors(), "page errors").toEqual([]);
	await mounted.page.evaluate(() => document.querySelector("#cover")?.remove());
});
