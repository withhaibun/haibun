/**
 * Real-browser fit verification for shu-polymorphic-graph-view (jsdom proves nothing about WebGL/layout).
 * Serves the BUILT bundle from a stub server and asserts the invariants that define "fitted":
 *   1. the canvas displays exactly at its container box (no overflow / scrollbars),
 *   2. the drawing buffer is rect × devicePixelRatio (anything else = blur),
 *   3. the camera aspect matches the rect aspect (anything else = stretch),
 * at mount AND after a container resize. RPC/SSE against the stub 404s; the geometry doesn't need data.
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";

const BUNDLE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "build", "assets", "shu-polymorphic-graph-view.js");

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script src="/bundle.js"></script></head>
<body style="margin:0">
	<div id="box" style="position:fixed;left:0;top:0;width:700px;height:500px;">
		<shu-polymorphic-graph-view style="display:block;width:100%;height:100%"></shu-polymorphic-graph-view>
	</div>
</body></html>`;

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

let server: Server;
let browser: Browser;
let page: Page;
const pageErrors: string[] = [];

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
	// The canvas fills the view's graph area — the box below the in-flow view head + filter rows, whose height is
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
	const bundle = readFileSync(BUNDLE_PATH, "utf-8"); // throws if not built — run `npm run bundle:polymorphic` first
	server = createServer((req, res) => {
		if (req.url === "/") {
			res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
		} else if (req.url === "/bundle.js") {
			res.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle);
		} else {
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
	browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
	page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
	page.on("pageerror", (e) => pageErrors.push(e.message));
	await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
	await page.waitForFunction(
		() => {
			const fe = document.querySelector("shu-polymorphic-graph-view");
			const scene = fe?.querySelector("a-scene") as (HTMLElement & { camera?: unknown }) | null;
			const canvas = fe?.querySelector("canvas") as HTMLCanvasElement | null;
			return Boolean(scene?.camera && canvas && canvas.width > 0);
		},
		undefined,
		{ timeout: 30_000 },
	);
}, 60_000);

afterAll(async () => {
	await browser?.close();
	await new Promise<void>((res) => {
		server?.close(() => res());
	});
});

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
	// The stub page installs no EventStream, so the live-update subscription fails fast by design; the real app installs one at boot.
	const unexpected = pageErrors.filter((e) => !e.includes("no EventStream installed"));
	expect(unexpected).toEqual([]);
});
