/**
 * Real-browser fit verification for shu-polymorphic-graph-view (jsdom doesn't prove WebGL/layout behaviour).
 * Serves the BUILT bundle on the started test page and asserts the invariants that define "fitted":
 *   1. the canvas displays exactly at its container box (without overflow / scrollbars),
 *   2. the drawing buffer is rect × devicePixelRatio (anything else = blur),
 *   3. the camera aspect matches the rect aspect (anything else = stretch),
 * at mount AND after a container resize. RPC/SSE against the stub 404s; the geometry doesn't need data.
 */
import type { Page } from "playwright";
import { openPolymorphicPage, type TOpenedPage } from "./polymorphic-page.test-fake.js";
import { afterAll, beforeAll, expect, test } from "vitest";

type Fit = {
	rect: { w: number; h: number };
	area: { w: number; h: number };
	buffer: { w: number; h: number };
	dpr: number;
	pixelRatio: number;
	cameraAspect: number;
	scrollW: number;
	scrollH: number;
};

let opened: TOpenedPage;
let page: Page;

const measureFit = (): Promise<Fit> =>
	page.evaluate(() => {
		const fe = document.querySelector("shu-polymorphic-graph-view") as HTMLElement;
		const canvas = fe.querySelector("canvas") as HTMLCanvasElement;
		const scene = fe.querySelector("a-scene") as HTMLElement & { camera: { aspect: number }; renderer: { getPixelRatio(): number } };
		const r = canvas.getBoundingClientRect();
		const a = (fe.querySelector(".graph-area") as HTMLElement).getBoundingClientRect();
		return {
			rect: { w: Math.round(r.width), h: Math.round(r.height) },
			area: { w: Math.round(a.width), h: Math.round(a.height) },
			buffer: { w: canvas.width, h: canvas.height },
			dpr: devicePixelRatio,
			pixelRatio: scene.renderer.getPixelRatio(),
			cameraAspect: scene.camera.aspect,
			scrollW: document.documentElement.scrollWidth,
			scrollH: document.documentElement.scrollHeight,
		};
	});

/** Returns each fit invariant `fit` breaks for a container of `w` × `h`, as a message that names the measured values. */
const fitViolations = (fit: Fit, w: number, h: number): string[] =>
	[
		// The canvas fills the view's graph area: the box below the in-flow view head + filter rows, whose height is the
		// container's minus that chrome. Width spans the container; height is checked against the measured area.
		Math.abs(fit.rect.w - w) > 2 && `canvas display width ${fit.rect.w} should be ${w}`,
		fit.area.h <= h * 0.7 && `graph area height ${fit.area.h} must be most of the ${h} container (chrome only above)`,
		Math.abs(fit.rect.h - fit.area.h) > 2 && `canvas display height ${fit.rect.h} should fill its graph area ${fit.area.h}`,
		Math.abs(fit.buffer.w - fit.rect.w * fit.pixelRatio) > 2 * fit.pixelRatio && `buffer ${fit.buffer.w} must be rect×pixelRatio (else blurry)`,
		Math.abs(fit.buffer.h - fit.rect.h * fit.pixelRatio) > 2 * fit.pixelRatio && `buffer ${fit.buffer.h} must be rect×pixelRatio (else blurry)`,
		Math.abs(fit.cameraAspect - fit.rect.w / fit.rect.h) > 0.02 && `camera aspect ${fit.cameraAspect} must match display aspect (else stretched)`,
		fit.scrollW > 1400 && `page width ${fit.scrollW} overflows horizontally (scrollbars)`,
		fit.scrollH > 900 && `page height ${fit.scrollH} overflows vertically (scrollbars)`,
	].filter((violation): violation is string => violation !== false);

/** How long the view has to fit a new container: its ResizeObserver, the frame that resizes the renderer, and the debounced
 *  refresh of the cursor's bounds. */
const REFIT_TIMEOUT_MS = 10_000;

/** Waits until the canvas fits a container of `w` × `h`, and fails with each invariant it still breaks at the timeout. */
const expectFitted = (w: number, h: number) => expect.poll(async () => fitViolations(await measureFit(), w, h), { timeout: REFIT_TIMEOUT_MS }).toEqual([]);

/** The cursor's cached bounds of the canvas and the canvas's own bounds, each rounded to a pixel. */
const cursorBounds = () =>
	page.evaluate(() => {
		const fe = document.querySelector("shu-polymorphic-graph-view") as HTMLElement;
		const canvas = fe.querySelector("canvas") as HTMLCanvasElement;
		const cursorEl = fe.querySelector("[cursor]") as HTMLElement & { components: { cursor: { canvasBounds: DOMRect } } };
		const box = (r: DOMRect) => ({ left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) });
		return { cached: box(cursorEl.components.cursor.canvasBounds), fresh: box(canvas.getBoundingClientRect()) };
	});

/** Waits until the cursor's cached bounds match the canvas's, and fails with both at the timeout. */
const expectCursorBoundsFresh = () =>
	expect
		.poll(
			async () => {
				const { cached, fresh } = await cursorBounds();
				return JSON.stringify(cached) === JSON.stringify(fresh)
					? []
					: [`cursor's cached canvas bounds ${JSON.stringify(cached)} don't match the canvas's ${JSON.stringify(fresh)}`];
			},
			{ timeout: REFIT_TIMEOUT_MS },
		)
		.toEqual([]);

beforeAll(async () => {
	opened = await openPolymorphicPage({ external: false, box: { width: 700, height: 500 }, deviceScaleFactor: 2 });
	page = opened.page;
}, 60_000);

afterAll(() => opened.close());

test("canvas fits its container at mount: display == box, buffer == display×dpr, aspect matches", { timeout: 30_000 }, async () => {
	await expectFitted(700, 500);
	const fit = await measureFit();
	expect(fit.pixelRatio, "renderer must honor devicePixelRatio (else blurry on retina)").toBe(fit.dpr);
});

test("canvas refits after the container resizes", { timeout: 30_000 }, async () => {
	await page.evaluate(() => {
		const box = document.querySelector("#box") as HTMLElement;
		box.style.width = "900px";
		box.style.height = "400px";
	});
	await expectFitted(900, 400);
});

test("mouse-pick bounds refresh after the container resizes (hover/click translation)", { timeout: 30_000 }, async () => {
	await expectCursorBoundsFresh();
});

test("mouse-pick bounds refresh after the canvas MOVES without resizing (strip scroll / column shifts)", { timeout: 30_000 }, async () => {
	await page.evaluate(() => {
		(document.querySelector("#box") as HTMLElement).style.left = "150px";
	});
	await expectCursorBoundsFresh();
});

test("the view boots and runs without page errors", () => {
	const unexpected = opened.errors();
	expect(unexpected).toEqual([]);
});
