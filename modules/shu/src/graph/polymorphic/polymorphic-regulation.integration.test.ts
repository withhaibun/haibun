/**
 * Real-browser self-regulation of shu-polymorphic-graph-view: a headless browser draws through a software rasterizer,
 * where a frame of a modest scene takes tens of milliseconds, so this is the environment that needs the regulator.
 *
 * The invariant: with a selected node and nothing moving, a scene whose frames are slow measures that time, rests the
 * breath, and draws no frame at all, so the run that opened the page does nothing on it after that.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { DEFAULT_REGULATION_THRESHOLDS } from "./polymorphic-regulator.js";
import { mountPolymorphicPage, quadsNamed, type TMountedPage } from "./polymorphic-page.test-fake.js";

/** Enough marks that a software-rasterized frame is plainly slow. */
const NODE_COUNT = 144;
const QUADS = quadsNamed(Array.from({ length: NODE_COUNT }, (_, i) => `n-${i}`));

let mounted: TMountedPage;
type Regulation = { resting: boolean; frameTimeMs: number | null; samples: number };
const REGULATION = `document.querySelector("shu-polymorphic-graph-view").inspect().regulation`;
const FRAME = `document.querySelector("a-scene").renderer.info.render.frame`;
const REST_TICKS = 120;

/** Wait until the gate has ticked `REST_TICKS` more times, then return how many frames were drawn over them. */
async function framesOverRestTicks(): Promise<number> {
	const before = (await mounted.page.evaluate(FRAME)) as number;
	const ticks = (await mounted.inspect()).render.ticks;
	await mounted.page.waitForFunction(
		(until) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { render: { ticks: number } } }).inspect().render.ticks >= until,
		ticks + REST_TICKS,
		{ timeout: 15_000 },
	);
	return ((await mounted.page.evaluate(FRAME)) as number) - before;
}

beforeAll(async () => {
	mounted = await mountPolymorphicPage();
	// Feed the scene, wait for it to rest, then select a node, which gives it the glow the breath rides.
	await mounted.feed(QUADS);
	await mounted.select("n-0");
}, 90_000);

afterAll(() => mounted?.close());

test("under a software rasterizer the scene measures its frames as slow and rests the breath", { timeout: 60_000 }, async () => {
	// The breath draws a frame every beat until the window fills; one frame in ten is measured.
	await mounted.page.waitForFunction(
		(n) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { regulation: { samples: number } } }).inspect().regulation.samples >= n,
		DEFAULT_REGULATION_THRESHOLDS.windowSamples,
		{ timeout: 45_000 },
	);
	const regulation = (await mounted.page.evaluate(REGULATION)) as Regulation;
	expect(mounted.errors(), "page errors").toEqual([]);
	expect(regulation.frameTimeMs, "a software-rasterized frame of this scene takes more than the limit allows at ten beats a second").toBeGreaterThan(
		(DEFAULT_REGULATION_THRESHOLDS.decorativeShareLimit * 1000) / DEFAULT_REGULATION_THRESHOLDS.beatsPerSecond,
	);
	expect(regulation.resting, `resting on ${regulation.frameTimeMs} ms a frame`).toBe(true);
});

test("at rest with a selected node, the scene draws no frame: the glow is held, not breathed", { timeout: 30_000 }, async () => {
	// The beat after the signal draws the held glow once and the gate pauses the scene; measure from the pause.
	await mounted.page.waitForFunction(
		() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { render: { paused: boolean } } }).inspect().render.paused === true,
		undefined,
		{ timeout: 10_000 },
	);
	expect(await framesOverRestTicks(), `frames drawn over ${REST_TICKS} gate ticks with the breath resting`).toBe(0);
	expect(mounted.errors(), "page errors").toEqual([]);
});

test("a feed that changes nothing visible draws no frame; one that changes the visible model draws", { timeout: 60_000 }, async () => {
	// The page's own requests return to it as observations, and with instrumentation hidden they change nothing
	// visible. A scene that draws on every feed draws on its own recordings.
	const before = (await mounted.page.evaluate(FRAME)) as number;
	await mounted.feed(QUADS);
	expect(await framesOverRestTicks(), "frames drawn for a feed of the same model").toBe(0);
	await mounted.feed([...QUADS, ...quadsNamed(["n-more"])]);
	expect(((await mounted.page.evaluate(FRAME)) as number) - before, "a changed model is drawn").toBeGreaterThan(0);
	expect(mounted.errors(), "page errors").toEqual([]);
});
