/**
 * Real-browser self-regulation of shu-polymorphic-graph-view: a headless browser draws through a software rasterizer,
 * where a frame of a modest scene takes tens of milliseconds, so this is the environment that needs the regulator.
 *
 * The invariant: with a selected node at rest, a scene whose frames are slow measures that time, rests the
 * breath, and doesn't draw a frame, so the actuality that opened the page doesn't draw on it after that. A breath that ran
 * would draw ten frames a second, so a scene at rest that doesn't draw a frame over a couple of seconds has measured its frames as
 * slow and rested it.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { BOX, mountPolymorphicPage, quadsNamed, type TMountedPage } from "../../../test/polymorphic-page.js";

/** Enough marks that a software-rasterized frame is plainly slow. */
const NODE_COUNT = 144;
const QUADS = quadsNamed(Array.from({ length: NODE_COUNT }, (_, i) => `n-${i}`));

let mounted: TMountedPage;
const REST_FRAMES = 120;

beforeAll(async () => {
	mounted = await mountPolymorphicPage();
	// Feed the scene, wait for it to rest, then select a node, which gives it the glow the breath rides.
	await mounted.feed(QUADS);
	await mounted.select("n-0");
}, 90_000);

afterAll(() => mounted?.close());

test("under a software rasterizer, a scene at rest with a selected node rests the breath: it doesn't draw a frame, the glow held", { timeout: 30_000 }, async () => {
	// The breath rests until a measurement shows it may run, so the frames measured are those the scene drew for its
	// changes, feeding and selecting, and the scene pauses once it has drawn them. The beat after the signal draws the held
	// glow once and the gate pauses the scene; measure from the pause.
	await mounted.atRest();
	expect(await mounted.framesOver(REST_FRAMES), `frames drawn over ${REST_FRAMES} animation frames with the breath resting`).toBe(0);
	expect(mounted.errors(), "page errors").toEqual([]);
});

test("a scene at rest given a change states itself busy in the task that changes it, so a reader waits for the change to be drawn", { timeout: 30_000 }, async () => {
	// The gate ticks once a frame, so a change made between ticks is drawn from the next one. A reader that waits for the
	// rest after a change waits for the change to be drawn, however long a frame takes.
	await mounted.atRest();
	const busy = await mounted.page.evaluate((reading) => {
		const view = document.querySelector("shu-polymorphic-graph-view") as unknown as { scene: { setSelectedSubject(s: string): void } } & HTMLElement;
		view.scene.setSelectedSubject("n-0");
		return view.querySelector(reading)?.getAttribute("aria-busy");
	}, `[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y}"]`);
	expect(busy, "the reading states busy in the task that selected the node again").toBe("true");
	expect(mounted.errors(), "page errors").toEqual([]);
});

test("a canvas that moves without resizing doesn't draw a frame; one that resizes draws", { timeout: 60_000 }, async () => {
	// A page that lays out again after the scene rests, as a late stylesheet or a column opening beside it does, moves the
	// canvas. What the canvas shows is the same wherever it is, so only a changed size is drawn again.
	await mounted.atRest();
	await mounted.page.evaluate(`document.getElementById("box").style.top = "41px"`);
	expect(await mounted.framesOver(REST_FRAMES), "frames drawn for a canvas that moved").toBe(0);
	const before = await mounted.framesDrawn();
	await mounted.page.evaluate(`document.getElementById("box").style.width = "${BOX.width / 2}px"`);
	await mounted.page.waitForFunction(
		(was) => (document.querySelector("a-scene") as unknown as { renderer: { info: { render: { frame: number } } } }).renderer.info.render.frame > was,
		before,
		{ timeout: 15_000 },
	);
	expect(mounted.errors(), "page errors").toEqual([]);
});

test("a feed that doesn't change the visible model doesn't draw a frame; one that changes the visible model draws", { timeout: 60_000 }, async () => {
	// The page's own requests return to it as observations, and with instrumentation hidden they don't change the
	// visible model. A scene that draws on every feed draws on its own recordings.
	await mounted.atRest();
	const before = await mounted.framesDrawn();
	await mounted.feed(QUADS);
	expect(await mounted.framesOver(REST_FRAMES), "frames drawn for a feed of the same model").toBe(0);
	await mounted.feed([...QUADS, ...quadsNamed(["n-more"])]);
	expect((await mounted.framesDrawn()) - before, "a changed model is drawn").toBeGreaterThan(0);
	expect(mounted.errors(), "page errors").toEqual([]);
});
