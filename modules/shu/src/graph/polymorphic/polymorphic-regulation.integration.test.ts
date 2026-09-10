/**
 * Real-browser self-regulation of shu-polymorphic-graph-view: a headless browser draws through a software rasterizer,
 * where a frame of a modest scene costs tens of milliseconds, so this is the environment the regulator exists for.
 *
 * The invariant: with a selected node and nothing moving, a scene whose frames are expensive measures that cost,
 * rests the breath, and draws no frame at all; the run that opened the page pays nothing for it after that. A page
 * left open with a selection once held eight cores this way, for as long as it stayed open.
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { DEFAULT_REGULATION_THRESHOLDS } from "./polymorphic-regulator.js";

const BUNDLE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "build", "assets", "shu-polymorphic-graph-view.js");

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script src="/bundle.js"></script></head>
<body style="margin:0">
	<div id="box" style="position:fixed;left:0;top:0;width:1000px;height:700px;">
		<shu-polymorphic-graph-view style="display:block;width:100%;height:100%"></shu-polymorphic-graph-view>
	</div>
</body></html>`;

/** Enough marks that a software-rasterized frame is plainly expensive: one property quad per node, as a snapshot holds
 *  them, fed through the scene's own model entry so every node is built the way the app builds it. */
const NODE_COUNT = 144;
const QUADS = Array.from({ length: NODE_COUNT }, (_, i) => ({ subject: `n-${i}`, namedGraph: "Email", predicate: "name", object: `n-${i}`, timestamp: 0 }));

let server: Server;
let browser: Browser;
let page: Page;
const pageErrors: string[] = [];
/** Mounting the raw bundle without the app boot reports exactly this once. */
const unexpectedErrors = () => pageErrors.filter((m) => !m.includes("no EventStream installed"));

type Regulation = { resting: boolean; frameCostMs: number | null; samples: number };
const REGULATION = `document.querySelector("shu-polymorphic-graph-view").inspect().regulation`;
const FRAME = `document.querySelector("a-scene").renderer.info.render.frame`;

beforeAll(async () => {
	const bundle = readFileSync(BUNDLE_PATH, "utf-8"); // throws if not built — run `npm run bundle:polymorphic` first
	server = createServer((req, res) => {
		if (req.url === "/") res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
		else if (req.url === "/bundle.js") res.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle);
		else res.writeHead(404).end();
	});
	await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
	browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
	page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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
	// Feed the scene as the view does, wait for the layout to settle and the engine to rest, then select a node, which
	// gives it the glow the breath rides.
	await page.evaluate((quads) => {
		const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { scene: { setModel(model: unknown): void } };
		el.scene.setModel({ quads, visibleQuads: quads, clusters: [], knownClusters: new Map(), hiddenGraphs: [], hiddenPredicates: [], perTypeLimit: 1000, timeCursor: null });
	}, QUADS);
	await page.waitForFunction(
		(count) => {
			const i = (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { nodes: number; engineMode: string; tween: unknown } }).inspect();
			return i.nodes === count && i.engineMode === "frozen" && i.tween === null;
		},
		NODE_COUNT,
		{ timeout: 45_000 },
	);
	await page.evaluate(() =>
		(document.querySelector("shu-polymorphic-graph-view") as unknown as { scene: { setSelectedSubject(id: string): void } }).scene.setSelectedSubject("n-0"),
	);
	await page.waitForFunction(
		() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { highlighted: number } }).inspect().highlighted === 1,
		undefined,
		{ timeout: 10_000 },
	);
}, 60_000);

afterAll(async () => {
	await browser?.close();
	await new Promise<void>((res) => {
		server?.close(() => res());
	});
});

test("under a software rasterizer the scene measures its frames as expensive and rests the breath", { timeout: 60_000 }, async () => {
	// The breath draws a frame every beat until the window fills; one frame in ten is measured.
	await page.waitForFunction(
		(n) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { regulation: { samples: number } } }).inspect().regulation.samples >= n,
		DEFAULT_REGULATION_THRESHOLDS.windowSamples,
		{ timeout: 45_000 },
	);
	const regulation = (await page.evaluate(REGULATION)) as Regulation;
	expect(unexpectedErrors(), `page errors: ${pageErrors.join("; ")}`).toEqual([]);
	expect(regulation.frameCostMs, "a software-rasterized frame of this scene costs more than the budget allows at ten beats a second").toBeGreaterThan(
		(DEFAULT_REGULATION_THRESHOLDS.decorativeBudgetShare * 1000) / DEFAULT_REGULATION_THRESHOLDS.beatsPerSecond,
	);
	expect(regulation.resting, `resting on ${regulation.frameCostMs} ms a frame`).toBe(true);
});

test("at rest with a selected node, the scene draws no frame: the glow is held, not breathed", { timeout: 30_000 }, async () => {
	// The beat after the signal draws the held glow once and the gate pauses the scene; measure from the pause.
	await page.waitForFunction(
		() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { render: { paused: boolean } } }).inspect().render.paused === true,
		undefined,
		{ timeout: 10_000 },
	);
	const before = (await page.evaluate(FRAME)) as number;
	await page.waitForTimeout(2_000);
	const after = (await page.evaluate(FRAME)) as number;
	expect(after - before, "frames drawn over two seconds with the breath resting").toBe(0);
	expect(unexpectedErrors(), `page errors: ${pageErrors.join("; ")}`).toEqual([]);
});

test("a feed that changes nothing visible draws no frame; one that changes the visible model draws", { timeout: 30_000 }, async () => {
	// The page's own requests come back to it as observations, and with instrumentation hidden they change nothing
	// visible. A scene that drew on every feed drew on its own recordings without end.
	const before = (await page.evaluate(FRAME)) as number;
	await page.evaluate((quads) => {
		const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { scene: { setModel(model: unknown): void } };
		el.scene.setModel({ quads, visibleQuads: quads, clusters: [], knownClusters: new Map(), hiddenGraphs: [], hiddenPredicates: [], perTypeLimit: 1000, timeCursor: null });
	}, QUADS);
	await page.waitForTimeout(1_500);
	expect(((await page.evaluate(FRAME)) as number) - before, "frames drawn for a feed of the same model").toBe(0);
	const more = [...QUADS, { subject: "n-more", namedGraph: "Email", predicate: "name", object: "n-more", timestamp: 0 }];
	await page.evaluate((quads) => {
		const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { scene: { setModel(model: unknown): void } };
		el.scene.setModel({ quads, visibleQuads: quads, clusters: [], knownClusters: new Map(), hiddenGraphs: [], hiddenPredicates: [], perTypeLimit: 1000, timeCursor: null });
	}, more);
	await page.waitForFunction(
		(count) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { nodes: number } }).inspect().nodes === count,
		NODE_COUNT + 1,
		{ timeout: 15_000 },
	);
	expect(((await page.evaluate(FRAME)) as number) - before, "a changed model is drawn").toBeGreaterThan(0);
	expect(unexpectedErrors(), `page errors: ${pageErrors.join("; ")}`).toEqual([]);
});
