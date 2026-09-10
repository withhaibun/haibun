/**
 * Real-browser pick/projection agreement for shu-polymorphic-graph-view (jsdom proves nothing about THREE picking).
 *
 * The invariant: pickAt(projectedCentre(node)) === node: the pick and the projection must agree AT ANY INSTANT,
 * including between an engine tick and the next render frame. The camera side of this held after pointerRay began
 * forcing a fresh camera matrix; this test pins the OBJECT side: when the engine's node coordinates have moved and
 * no frame has rendered yet, every sprite's transform is one frame stale, and a pick raycast against those stale
 * transforms misses at the freshly-projected centre: the e2e drag flake's exact "N nodes, none pickable at centre"
 * signature. The moved-coordinates state is created and picked inside ONE page.evaluate, so no render frame can
 * re-sync the sprites in between: the intermittent between-frames window, made deterministic.
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

/** Pinned, well-separated node positions so the layout holds them exactly where the test expects. */
const NODES = [
	{ id: "n-a", x: -60, y: -40 },
	{ id: "n-b", x: 60, y: -40 },
	{ id: "n-c", x: -60, y: 40 },
	{ id: "n-d", x: 60, y: 40 },
];

type PickRow = { id: string; x: number; y: number; picked: string | null };

let server: Server;
let browser: Browser;
let page: Page;
const pageErrors: string[] = [];
/** The pick geometry needs no event stream; mounting the raw bundle without the app boot reports exactly this once. */
const unexpectedErrors = () => pageErrors.filter((m) => !m.includes("no EventStream installed"));

/** In-page: ask the view where it draws each node, then probe the production pick at that pixel. Both sides are the
 * production pair: a copy of the projection here could only ever agree with itself, never catch the two drifting.
 * Runs synchronously, so no frame can re-sync the sprites between the projection and the pick. */
const PICK_ALL = `(() => {
	const el = document.querySelector("shu-polymorphic-graph-view");
	return [...el.nodeMap.values()].map((n) => {
		const at = el.projectNodeToScreen(n.id);
		return { id: n.id, x: at.x, y: at.y, picked: el.pickAt(at.x, at.y) };
	});
})()`;

beforeAll(async () => {
	const bundle = readFileSync(BUNDLE_PATH, "utf-8"); // throws if not built, run `npm run bundle:polymorphic` first
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
	// Feed pinned nodes straight into the force-graph and frame them: the pick geometry under test is independent
	// of the store pipeline. fx/fy/fz pin each node so the engine holds it exactly at its coordinates. The lib
	// decorates these SAME objects (nodeThreeObject → __sprite/__baseScale), so pointing the pipeline's nodeMap at
	// them gives pickNodeAt its real node set without the store.
	await page.evaluate((nodes) => {
		const el = document.querySelector("shu-polymorphic-graph-view") as unknown as {
			graph: { graphData(d?: { nodes: unknown[]; links: unknown[] }): { nodes: Array<{ id: string }> } };
			pipeline: { nodeMap: Map<string, unknown> };
			fitGraph(): void;
		};
		el.graph.graphData({
			nodes: nodes.map((n) => ({ id: n.id, name: n.id, type: "Email", x: n.x, y: n.y, z: 0, fx: n.x, fy: n.y, fz: 0 })),
			links: [],
		});
		el.pipeline.nodeMap = new Map(el.graph.graphData().nodes.map((n) => [n.id, n]));
		el.fitGraph();
	}, NODES);
	// Wait until every node has its sprite and a rendered frame has synced the transforms (baseline picks succeed).
	await page.waitForFunction(
		(count) => {
			const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { nodeMap?: Map<string, { __sprite?: unknown }> };
			return el.nodeMap?.size === count && [...el.nodeMap.values()].every((n) => n.__sprite);
		},
		NODES.length,
		{ timeout: 30_000 },
	);
	await page.waitForTimeout(1200); // let the fit tween finish framing before the baseline reads projections
}, 60_000);

afterAll(async () => {
	await browser?.close();
	await new Promise<void>((res) => {
		server?.close(() => res());
	});
});

test("baseline: with rendered frames in sync, every node picks at its projected centre", { timeout: 30_000 }, async () => {
	const rows = (await page.evaluate(PICK_ALL)) as PickRow[];
	expect(unexpectedErrors(), `page errors: ${pageErrors.join("; ")}`).toEqual([]);
	for (const row of rows) expect(row.picked, `${row.id} at (${row.x.toFixed(0)},${row.y.toFixed(0)})`).toBe(row.id);
});

test("between frames: after the engine moves nodes and before any render, the pick still finds each node at its freshly-projected centre", { timeout: 30_000 }, async () => {
	// Move every node's engine coordinates and pick in the SAME synchronous evaluate: the state a pick sees when it
	// runs between an engine tick and the next render frame, when sprite transforms are one frame stale.
	const rows = (await page.evaluate(`(() => {
		const el = document.querySelector("shu-polymorphic-graph-view");
		for (const n of el.nodeMap.values()) { n.x += 25; n.y += 15; n.fx = n.x; n.fy = n.y; }
		return ${PICK_ALL};
	})()`)) as PickRow[];
	expect(unexpectedErrors(), `page errors: ${pageErrors.join("; ")}`).toEqual([]);
	for (const row of rows) expect(row.picked, `${row.id} at (${row.x.toFixed(0)},${row.y.toFixed(0)}), stale sprite transform?`).toBe(row.id);
});
