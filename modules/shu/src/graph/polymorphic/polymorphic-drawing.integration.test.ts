/**
 * Real-browser drawing on demand: a headless browser draws through a software rasterizer, where a frame takes tens of
 * milliseconds, so a scene that draws a frame it doesn't need holds the page's main thread, and every key and click
 * waits behind it. What the scene draws is what changed, and a scene with nothing changing draws nothing.
 *
 * The invariants: a feed of new records into a scene at rest is drawn in a few frames and the scene rests again, and a
 * pointer resting over the canvas draws nothing. Each is a frame count over stated states, never a time.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { mountPolymorphicPage, quadsNamed, type TMountedPage } from "./polymorphic-page.test-fake.js";

const NAMES = Array.from({ length: 24 }, (_, i) => `n-${i}`);
const REST_TICKS = 120;
/** What three new records may take to draw: the tick that places them, their labels as their text is laid out, their
 *  welcome glow on and off. A scene that drew for a grace after every change drew over seventy. */
const FEED_FRAMES = 10;

let mounted: TMountedPage;

beforeAll(async () => {
	mounted = await mountPolymorphicPage();
	await mounted.feed(quadsNamed(NAMES));
}, 90_000);

afterAll(() => mounted?.close());

test("a feed of new records into a scene at rest is drawn in a few frames, and the scene rests again", { timeout: 60_000 }, async () => {
	await mounted.atRest();
	const before = await mounted.framesDrawn();
	await mounted.feed(quadsNamed([...NAMES, "n-new-1", "n-new-2", "n-new-3"]));
	await mounted.atRest();
	expect((await mounted.framesDrawn()) - before, "frames drawn for three new records").toBeLessThanOrEqual(FEED_FRAMES);
	expect(mounted.errors(), "page errors").toEqual([]);
});

test("a pointer resting over the canvas draws nothing", { timeout: 60_000 }, async () => {
	const box = await mounted.box();
	await mounted.page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
	await mounted.atRest();
	expect(await mounted.framesOver(REST_TICKS), `frames drawn over ${REST_TICKS} gate ticks with the pointer at rest over the canvas`).toBe(0);
	expect(mounted.errors(), "page errors").toEqual([]);
});
