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

const expectFitted = (fit: Fit, w: number, h: number) => {
	// The canvas fills the view's graph area: the box below the in-flow view head + filter rows, whose height is
	// the container's minus that chrome. Width spans the container; height is asserted against the measured area.
	expect(Math.abs(fit.rect.w - w), `canvas display width ${fit.rect.w} should be ${w}`).toBeLessThanOrEqual(2);
	expect(fit.area.h, `graph area height must be most of the ${h} container (chrome only above)`).toBeGreaterThan(h * 0.7);
	expect(Math.abs(fit.rect.h - fit.area.h), `canvas display height ${fit.rect.h} should fill its graph area ${fit.area.h}`).toBeLessThanOrEqual(2);
	expect(Math.abs(fit.buffer.w - fit.rect.w * fit.pixelRatio), `buffer ${fit.buffer.w} must be rect×pixelRatio (else blurry)`).toBeLessThanOrEqual(2 * fit.pixelRatio);
	expect(Math.abs(fit.buffer.h - fit.rect.h * fit.pixelRatio), `buffer ${fit.buffer.h} must be rect×pixelRatio (else blurry)`).toBeLessThanOrEqual(2 * fit.pixelRatio);
	expect(Math.abs(fit.cameraAspect - fit.rect.w / fit.rect.h), `camera aspect ${fit.cameraAspect} must match display aspect (else stretched)`).toBeLessThanOrEqual(0.02);
	expect(fit.scrollW, "page must not overflow horizontally (scrollbars)").toBeLessThanOrEqual(1400);
	expect(fit.scrollH, "page must not overflow vertically (scrollbars)").toBeLessThanOrEqual(900);
};

beforeAll(async () => {
	opened = await openPolymorphicPage({ external: false, box: { width: 700, height: 500 }, deviceScaleFactor: 2 });
	page = opened.page;
}, 60_000);

afterAll(() => opened.close());

test("canvas fits its container at mount: display == box, buffer == display×dpr, aspect matches", { timeout: 30_000 }, async () => {
	await page.waitForTimeout(500); // let the rAF enforce loop assert once
	const fit = await measureFit();
	expect(fit.pixelRatio, "renderer must honor devicePixelRatio (else blurry on retina)").toBe(fit.dpr);
	expectFitted(fit, 700, 500);
});

test("canvas refits after the container resizes", { timeout: 30_000 }, async () => {
	await page.evaluate(() => {
		const box = document.querySelector("#box") as HTMLElement;
		box.style.width = "900px";
		box.style.height = "400px";
	});
	await page.waitForTimeout(500); // ResizeObserver + rAF
	expectFitted(await measureFit(), 900, 400);
});

test("mouse-pick bounds refresh after the container resizes (hover/click translation)", { timeout: 30_000 }, async () => {
	await page.waitForTimeout(700); // the cursor's bounds refresh is debounced behind the rendererresize event
	const d = await page.evaluate(() => {
		const fe = document.querySelector("shu-polymorphic-graph-view") as HTMLElement;
		const canvas = fe.querySelector("canvas") as HTMLCanvasElement;
		const cursorEl = fe.querySelector("[cursor]") as HTMLElement & { components: { cursor: { canvasBounds: DOMRect } } };
		const cached = cursorEl.components.cursor.canvasBounds;
		const fresh = canvas.getBoundingClientRect();
		return { cached: { w: Math.round(cached.width), h: Math.round(cached.height) }, fresh: { w: Math.round(fresh.width), h: Math.round(fresh.height) } };
	});
	expect(d.cached, "cursor's cached canvas bounds must match the resized canvas (else picks translate against the old rect)").toEqual(d.fresh);
});

test("mouse-pick bounds refresh after the canvas MOVES without resizing (strip scroll / column shifts)", { timeout: 30_000 }, async () => {
	await page.evaluate(() => {
		(document.querySelector("#box") as HTMLElement).style.left = "150px";
	});
	await page.waitForTimeout(1500); // rAF position sample (~0.5s) + A-Frame's debounced bounds refresh
	const d = await page.evaluate(() => {
		const fe = document.querySelector("shu-polymorphic-graph-view") as HTMLElement;
		const canvas = fe.querySelector("canvas") as HTMLCanvasElement;
		const cursorEl = fe.querySelector("[cursor]") as HTMLElement & { components: { cursor: { canvasBounds: DOMRect } } };
		return { cachedLeft: Math.round(cursorEl.components.cursor.canvasBounds.left), freshLeft: Math.round(canvas.getBoundingClientRect().left) };
	});
	expect(d.cachedLeft, "cursor's cached bounds must track a pure position change").toBe(d.freshLeft);
});

test("the view boots and runs without page errors", () => {
	const unexpected = opened.errors();
	expect(unexpected).toEqual([]);
});
