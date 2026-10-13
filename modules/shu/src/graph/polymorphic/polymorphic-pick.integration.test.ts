/**
 * Real-browser pick/projection agreement for shu-polymorphic-graph-view (jsdom doesn't prove THREE picking).
 *
 * The invariant: pickAt(projectedCentre(node)) === node: the pick and the projection must agree AT ANY INSTANT,
 * including between an engine tick and the next render frame. The camera side of this held after pointerRay began
 * forcing a fresh camera matrix; this test pins the OBJECT side: when the engine's node coordinates have moved and
 * a frame hasn't rendered yet, every sprite's transform is one frame stale, and a pick raycast against those stale
 * transforms misses at the freshly-projected centre: the e2e drag flake's exact "N nodes, none pickable at centre"
 * signature. The moved-coordinates state is created and picked inside ONE page.evaluate, so a render frame can't
 * re-sync the sprites in between: the intermittent between-frames window, made deterministic.
 */
import type { Page } from "playwright";
import { openPolymorphicPage, type TOpenedPage } from "./polymorphic-page.test-fake.js";
import { afterAll, beforeAll, expect, test } from "vitest";

/** Pinned, well-separated node positions so the layout holds them exactly where the test expects. */
const NODES = [
	{ id: "n-a", x: -60, y: -40 },
	{ id: "n-b", x: 60, y: -40 },
	{ id: "n-c", x: -60, y: 40 },
	{ id: "n-d", x: 60, y: 40 },
];

type PickRow = { id: string; x: number; y: number; picked: string | null };

let opened: TOpenedPage;
let page: Page;

/** In-page: ask the view where it draws each node, then probe the production pick at that pixel. Both sides are the
 * production pair: a copy of the projection here could only ever agree with itself, never catch the two drifting.
 * Runs synchronously, so a frame can't re-sync the sprites between the projection and the pick. */
const PICK_ALL = `(() => {
	const el = document.querySelector("shu-polymorphic-graph-view");
	return [...el.nodeMap.values()].map((n) => {
		const at = el.projectNodeToScreen(n.id);
		return { id: n.id, x: at.x, y: at.y, picked: el.pickAt(at.x, at.y) };
	});
})()`;

beforeAll(async () => {
	opened = await openPolymorphicPage({ external: false, box: { width: 700, height: 500 }, deviceScaleFactor: 1 });
	page = opened.page;
	// The page starts as the app's does, so the view paints its first (empty) model; nodes written into the graph before that
	// paint lands would be replaced by it.
	await page.waitForFunction(
		() => {
			const i = (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { repaintPending: boolean; followPending: boolean; tween: unknown } }).inspect();
			return !i.repaintPending && !i.followPending && i.tween === null;
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
		el.graph.graphData({ nodes: nodes.map((n) => ({ id: n.id, name: n.id, type: "Email", x: n.x, y: n.y, z: 0, fx: n.x, fy: n.y, fz: 0 })), links: [] });
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

afterAll(() => opened.close());

test("baseline: with rendered frames in sync, every node picks at its projected centre", { timeout: 30_000 }, async () => {
	const rows = (await page.evaluate(PICK_ALL)) as PickRow[];
	expect(opened.errors(), `page errors: ${opened.errors().join("; ")}`).toEqual([]);
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
	expect(opened.errors(), `page errors: ${opened.errors().join("; ")}`).toEqual([]);
	for (const row of rows) expect(row.picked, `${row.id} at (${row.x.toFixed(0)},${row.y.toFixed(0)}), stale sprite transform?`).toBe(row.id);
});
