/**
 * Real-browser pick/projection agreement for shu-polymorphic-graph-view (jsdom doesn't prove THREE picking).
 *
 * The invariant: a press and a click where a node draws open that node, AT ANY INSTANT, including between an engine tick
 * and the next render frame. Where the node draws is read through the library's own camera and projection, apart from
 * the scene's code, so the pick is held to what the reader sees. The camera side of this held after pointerRay began
 * forcing a fresh camera matrix; this test pins the OBJECT side: when the engine's node coordinates have moved and a frame
 * hasn't rendered yet, every sprite's transform is one frame stale, and a pick raycast against those stale transforms
 * misses at the freshly projected centre: the e2e drag flake's exact "N nodes, none pickable at centre" signature. The
 * moved coordinates are set and each node pressed inside ONE page.evaluate, so a render frame can't re-sync the sprites
 * in between: the intermittent between-frames window, made deterministic.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { SHU_EVENT } from "../../../domains/elements.js";
import type { TPaneOpen } from "../../derivations/pane-kinds.js";
import { mountPolymorphicPage, quadsNamed, type TMountedPage } from "../../../test/polymorphic-page.js";

const IDS = ["n-a", "n-b", "n-c", "n-d"];
/** How far the engine moves every node, in world units, before a frame draws it there. */
const MOVED = { x: 25, y: 15 };

type TPicked = { id: string; x: number; y: number; opened: string | null };

let mounted: TMountedPage;

/** In-page: move every node's engine coordinates by `moved`, then press and click each where the library's camera draws it,
 *  and note the node each click opened. Runs synchronously, so a frame can't re-sync the sprites between the move and the
 *  picks. */
const pressEach = ({ moved, opening }: { moved: { x: number; y: number }; opening: string }): TPicked[] => {
	type TVector = { x: number; y: number; project(camera: unknown): TVector };
	const view = document.querySelector("shu-polymorphic-graph-view");
	const scene = view?.querySelector("a-scene") as (Element & { camera: { updateMatrixWorld(force: boolean): void } }) | null;
	const engine = view?.querySelector("[forcegraph]") as Element & {
		components: { forcegraph: { forceGraph: { graphData(): { nodes: Array<{ id: string; x: number; y: number; z: number; fx?: number; fy?: number }> } } } };
	};
	const canvas = view?.querySelector("canvas");
	if (!scene || !canvas) throw new Error("the view lacks a scene or a canvas to press on");
	const THREE = (globalThis as unknown as { AFRAME: { THREE: { Vector3: new (x: number, y: number, z: number) => TVector } } }).AFRAME.THREE;
	const nodes = engine.components.forcegraph.forceGraph.graphData().nodes;
	for (const n of nodes) {
		n.x += moved.x;
		n.y += moved.y;
		n.fx = n.x;
		n.fy = n.y;
	}
	let opened: string | null = null;
	const heard = (e: Event) => {
		const { pane } = (e as CustomEvent<TPaneOpen>).detail;
		opened = pane.paneType === "entity" ? pane.id : null;
	};
	document.addEventListener(opening, heard);
	scene.camera.updateMatrixWorld(true);
	const shown = canvas.getBoundingClientRect();
	const picked = nodes.map((n) => {
		const ndc = new THREE.Vector3(n.x, n.y, n.z).project(scene.camera);
		const at = { clientX: shown.left + ((ndc.x + 1) / 2) * shown.width, clientY: shown.top + ((1 - ndc.y) / 2) * shown.height, button: 0, bubbles: true };
		opened = null;
		canvas.dispatchEvent(new PointerEvent("pointerdown", at));
		canvas.dispatchEvent(new PointerEvent("pointerup", at));
		canvas.dispatchEvent(new MouseEvent("click", at));
		return { id: n.id, x: at.clientX, y: at.clientY, opened };
	});
	document.removeEventListener(opening, heard);
	return picked;
};

beforeAll(async () => {
	mounted = await mountPolymorphicPage({ box: { width: 700, height: 500 } });
	await mounted.feed(quadsNamed(IDS));
	await mounted.scene((scene) => scene.fitGraph());
	await mounted.atRest();
}, 90_000);

afterAll(() => mounted?.close());

test("baseline: with rendered frames in sync, a press where each node draws opens it", { timeout: 30_000 }, async () => {
	const picked = await mounted.page.evaluate(pressEach, { moved: { x: 0, y: 0 }, opening: SHU_EVENT.PANE_OPEN });
	expect(mounted.errors(), `page errors: ${mounted.errors().join("; ")}`).toEqual([]);
	expect(picked.map((p) => p.id).sort()).toEqual([...IDS].sort());
	for (const p of picked) expect(p.opened, `${p.id} at (${p.x.toFixed(0)},${p.y.toFixed(0)})`).toBe(p.id);
});

test("between frames: after the engine moves nodes and before any render, a press where each node now draws still opens it", { timeout: 30_000 }, async () => {
	await mounted.atRest();
	const picked = await mounted.page.evaluate(pressEach, { moved: MOVED, opening: SHU_EVENT.PANE_OPEN });
	expect(mounted.errors(), `page errors: ${mounted.errors().join("; ")}`).toEqual([]);
	for (const p of picked) expect(p.opened, `${p.id} at (${p.x.toFixed(0)},${p.y.toFixed(0)}), stale sprite transform?`).toBe(p.id);
});
