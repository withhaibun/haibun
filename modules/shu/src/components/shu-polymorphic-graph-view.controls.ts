/**
 * Control + interaction steps for shu-polymorphic-graph-view, kept beside the element (the shu-graph-view.controls
 * pattern) so the graph's controls travel with the component. These are the GRAPH's own visual operations:
 * zoom/pan/orbit/fit, scope-to-type, reveal-a-node, hover, so feature tests for graphs read naturally
 * ("zoom in 50 pixels", "orbit 30 degrees left", "fit graph"). The functionality lives on the component
 * (zoomBy/panBy/orbitBy/fitGraph/openNode/setHoveredNode); this stepper drives it in the live app and reads inspect().
 *
 * Why component methods, not synthetic WebGL clicks: a Playwright pixel click does not reliably reach the lib's
 * raycaster headless (it emitted zero node clicks across every on-screen candidate). openNode() IS the real path a
 * click takes (onNodeClick → COLUMN_OPEN) and a genuine app entry point, so the open/resize/no-auto-zoom chain is
 * exercised faithfully. The lib's raycaster is the lib's concern, not this module's.
 *
 * Concern boundary: WHICH column is focused is the column browser's concern (shu-column-strip.controls), not here.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import { SHU_TEST_IDS } from "../test-ids.js";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps, type TFeatureStep } from "@haibun/core/lib/astepper.js";
import type { TDomainDefinition } from "@haibun/core/lib/resources.js";
import { actionOK, actionNotOK, actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import WebPlaywright from "@haibun/web-playwright";
import { saveImageArtifact } from "@haibun/web-playwright/artifact.js";
import type { Page } from "playwright";
import { objectId } from "../object-id.js";
import { VIEW_TYPES } from "../graph/polymorphic/polymorphic-views.js";
import type { TSettingsGroup } from "./view-head.js";

const POLYMORPHIC_IDS = SHU_TEST_IDS.POLYMORPHIC_VIEW;
/** What each settings group holds, in row order: ONE table: the opener waits on the first control to attach, and the
 *  "every option is under its group" assertion checks the whole list. The filters group renders the shared filter
 *  element rather than controls of its own, so it names none. */
/** The alpha a browser reports for a painted colour, in either shape it writes one: `rgba(r, g, b, a)` and the
 *  `color(srgb r g b / a)` a mixed colour comes back as. No alpha stated is opaque. */
export function paintedAlpha(background: string): number {
	const sliced = background.match(/\/\s*([\d.]+%?)\s*\)\s*$/)?.[1];
	if (sliced) return sliced.endsWith("%") ? Number.parseFloat(sliced) / 100 : Number.parseFloat(sliced);
	const parts = background.match(/^rgba?\(([^)]*)\)$/)?.[1]?.split(",");
	return parts && parts.length === 4 ? Number.parseFloat(parts[3]) : 1;
}

const SETTINGS_CONTROLS: Record<TSettingsGroup, string[]> = {
	layout: [
		POLYMORPHIC_IDS.ROTATE_XY,
		POLYMORPHIC_IDS.ROTATE_Z,
		POLYMORPHIC_IDS.VIEW_TYPE,
		POLYMORPHIC_IDS.GROUPED,
		POLYMORPHIC_IDS.GROUP_BY,
		POLYMORPHIC_IDS.FLATTEN,
		POLYMORPHIC_IDS.Z_BASIS,
		POLYMORPHIC_IDS.LABEL_AS_Z,
	],
	filters: [],
	scenes: [POLYMORPHIC_IDS.SCENE_PICKER, POLYMORPHIC_IDS.SCENE_NAME, POLYMORPHIC_IDS.SCENE_SAVE],
};

export const DOMAIN_GRAPH_ZOOM = "graph-zoom-direction";
const ZoomDirSchema = z.enum(["in", "out"]);
export const DOMAIN_GRAPH_PAN = "graph-pan-direction";
const PanDirSchema = z.enum(["left", "right", "up", "down"]);
export const DOMAIN_GRAPH_UNIT = "graph-measure-unit";
const UnitSchema = z.enum(["pixels", "percent"]);
export const DOMAIN_GRAPH_ZOOM_CMP = "graph-zoom-comparison";
const ZoomCmpSchema = z.enum(["closer", "farther"]);
export const DOMAIN_GRAPH_CHANGE = "graph-change";
const ChangeSchema = z.enum(["changed", "unchanged"]);
export const DOMAIN_GRAPH_GROUPING = "graph-grouping";
const GroupingSchema = z.enum(["group", "ungroup"]);
export const DOMAIN_GRAPH_FLATTEN = "graph-flatten";
const FlattenSchema = z.enum(["flatten", "unflatten"]);
export const DOMAIN_GRAPH_GROUP_AXIS = "graph-group-axis";
const GroupAxisSchema = z.enum(["role", "type"]);
export const DOMAIN_GRAPH_VIEW = "graph-view-type";
const ViewTypeSchema = z.enum(["force", "lr", "td", "gantt", "sequence"]);
export const DOMAIN_GRAPH_ZBASIS = "graph-z-basis";
const ZBasisSchema = z.enum(["valid time", "indexed time", "connections"]);
const ZBASIS_VALUE: Record<string, string> = { "valid time": "valid", "indexed time": "indexed", connections: "connections" };

const graphControlDomains: TDomainDefinition[] = [
	{ selectors: [DOMAIN_GRAPH_ZOOM], schema: ZoomDirSchema, description: "Zoom direction: in or out" },
	{ selectors: [DOMAIN_GRAPH_PAN], schema: PanDirSchema, description: "Pan/orbit direction: left, right, up, or down" },
	{ selectors: [DOMAIN_GRAPH_UNIT], schema: UnitSchema, description: "Measure unit: pixels or percent" },
	{ selectors: [DOMAIN_GRAPH_ZOOM_CMP], schema: ZoomCmpSchema, description: "Zoom comparison: closer or farther" },
	{ selectors: [DOMAIN_GRAPH_CHANGE], schema: ChangeSchema, description: "Whether the framing changed or unchanged" },
	{ selectors: [DOMAIN_GRAPH_GROUPING], schema: GroupingSchema, description: "Grouping toggle: group or ungroup" },
	{ selectors: [DOMAIN_GRAPH_FLATTEN], schema: FlattenSchema, description: "Flat-layout toggle: flatten or unflatten" },
	{ selectors: [DOMAIN_GRAPH_GROUP_AXIS], schema: GroupAxisSchema, description: "Grouping axis: role (the party axis) or type (@type)" },
	{ selectors: [DOMAIN_GRAPH_VIEW], schema: ViewTypeSchema, description: "Render type: force, lr, td, gantt, or sequence" },
	{ selectors: [DOMAIN_GRAPH_ZBASIS], schema: ZBasisSchema, description: "What the depth (z) axis encodes: valid time, indexed time, or connections" },
];

const COLUMN_OPEN = "column-open"; // SHU_EVENT.COLUMN_OPEN, captured to prove a node open reached the graph's onNodeClick
const SCOPED_REFETCH_BEGIN_MS = 350; // covers the scoped refetch's RPC dispatch + the view's 250ms repaint debounce
const HOVER_POP_MAX = 2.6; // a hover pop above this reads as "huge" (the regression): an independent ceiling, comfortably clear of the gentle magnify cap so a legit pop passes and a runaway one fails

type Viewport = { h: number; w: number; worldPerPx: number; calibratedH: number } | null;
type Camera = { x: number; y: number; z: number; target?: { x: number; y: number; z: number } | null } | null; // fov is deliberately NOT compared (it moves to hold worldPerPx); worldPerPx is the zoom signal
type Snapshot = { camera: Camera; viewport: Viewport; pos: Record<string, { x: number; y: number; z: number }> };

export default class ShuPolymorphicGraphViewControls extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: graphControlDomains }) };
	private snapshots = new Map<string, Snapshot>();
	private opened = new Map<string, string>(); // name → the bare id of the node an open targeted, so a later hover can re-find it
	private droppedAt = new Map<string, { x: number; y: number }>(); // name → where a drag left the node, so a later check reads the place it must hold

	/** The one lookup of the browser stepper, so the page and the artifact path cannot find different instances. */
	private webPlaywright(): WebPlaywright {
		const wp = this.getWorld().runtime.steppers?.find((s) => s instanceof WebPlaywright) as WebPlaywright | undefined;
		if (!wp) throw new Error("ShuPolymorphicGraphViewControls: WebPlaywright stepper not in the world");
		return wp;
	}

	private async page(): Promise<Page> {
		const wp = this.webPlaywright();
		return (await wp.getPage()) as unknown as Page;
	}

	/** A test-id'd element's client rect: the one reader for every step that measures containment against one. */
	private rectOf(page: Page, testId: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
		return page.evaluate((id) => {
			const r = (document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null)?.getBoundingClientRect();
			return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
		}, testId);
	}

	/** The view's own inspect() surface (via the shuPolymorphic global it registers): the one observable tests read. */
	private snapshot(page: Page): Promise<Snapshot> {
		return page.evaluate(() => {
			const fy = (window as unknown as { shuPolymorphic?: { inspect(): { camera: Camera; viewport: Viewport; sample: Array<{ id: string; x: number; y: number; z: number }> } } })
				.shuPolymorphic;
			if (!fy) throw new Error("shuPolymorphic not connected");
			const i = fy.inspect();
			const pos: Record<string, { x: number; y: number; z: number }> = {};
			for (const s of i.sample) pos[s.id] = { x: s.x, y: s.y, z: s.z };
			return { camera: i.camera, viewport: i.viewport, pos };
		});
	}

	/** Block until snapshot data has streamed in (RPC + the 250ms repaint debounce): the scene testids
	 * resolve when the A-Frame scene MOUNTS, which precedes the first data feed, so waiting on them races. */
	private async waitForNodes(page: Page, min: number): Promise<void> {
		await page.waitForFunction((m) => ((document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect?(): { nodes: number } })?.inspect?.().nodes ?? 0) >= m, min, {
			timeout: 15000,
		});
	}

	/** Wait for the layout to come to rest, so a snapshot is stable and a camera op is not raced by a settling tween. */
	private async settle(page: Page): Promise<void> {
		await page.waitForFunction(
			() => {
				const i = (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect?(): { engineMode: string; tween: unknown; repaintPending: boolean } })?.inspect?.();
				// A debounced repaint that has not run yet leaves the engine idle while the scene still shows the previous
				// placement: settled means nothing is running AND nothing is owed.
				return !!i && i.engineMode === "frozen" && i.tween === null && !i.repaintPending;
			},
			undefined,
			{ timeout: 15000 },
		);
	}

	/** Poll `read` until two consecutive samples are `stable` (or `iterations` elapse); `beforeEach` (e.g. settle) runs before every sample. */
	private async pollUntilStable<T>(
		page: Page,
		intervalMs: number,
		iterations: number,
		read: () => Promise<T>,
		stable: (now: T, prev: T) => boolean,
		beforeEach?: () => Promise<void>,
	): Promise<void> {
		await beforeEach?.();
		let prev = await read();
		for (let i = 0; i < iterations; i++) {
			await page.waitForTimeout(intervalMs);
			await beforeEach?.();
			const now = await read();
			if (stable(now, prev)) return;
			prev = now;
		}
	}

	/** Poll until the node count stops changing: an async refetch can land in two stages, so one settle isn't enough. */
	private async waitForStableCount(page: Page): Promise<void> {
		const count = () => page.evaluate(() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { nodes: number } }).inspect().nodes);
		await this.pollUntilStable(page, 300, 12, count, (now, prev) => now === prev);
	}

	/** A type-scope change refetches (RPC + repaint debounce) and can land in two stages (hide → refetch):
	 *  give the refetch time to begin, then wait until the node count stops changing. */
	private async settleScopedRefetch(page: Page): Promise<void> {
		await page.waitForTimeout(SCOPED_REFETCH_BEGIN_MS);
		await this.settle(page);
		await this.waitForStableCount(page);
	}

	/** Drive a method on the view's graph filter, false when no filter is on the view. */
	private callGraphFilter(page: Page, method: string, args: unknown[]): Promise<boolean> {
		return page.evaluate(
			({ m, a }) => {
				const f = document.querySelector("shu-polymorphic-graph-view shu-graph-filter") as unknown as Record<string, (...x: unknown[]) => void> | null;
				if (!f) return false;
				f[m](...a);
				return true;
			},
			{ m: method, a: args },
		);
	}

	/** Wait until the camera's fov is calibrated to the canvas height it has now. A window or column resize lands on
	 *  the canvas first and the fov compensation follows on the ResizeObserver, so a framing read between the two sees
	 *  worldPerPx scaled by the height change and mistakes it for a zoom. */
	private async waitForCalibratedViewport(page: Page): Promise<void> {
		await page.waitForFunction(
			() => {
				const v = (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { viewport: { h: number; calibratedH: number } | null } }).inspect().viewport;
				return v !== null && v.h > 0 && v.h === v.calibratedH;
			},
			undefined,
			{ timeout: 5_000 },
		);
	}

	/** Wait until the force layout STOPS spreading: the engine is frozen AND the world-space bbox radius has stopped
	 *  growing across consecutive polls. A from-scratch layout settles to its full extent over several engine stops with a
	 *  STABLE node count, so settle() (frozen) and waitForStableCount (count) both return mid-spread; the auto-fit follows
	 *  the spread, so any assertion about a SETTLED camera (hover-doesn't-move, fits-the-view) must wait for this. */
	private async waitForLayoutStable(page: Page): Promise<void> {
		const radius = () => page.evaluate(() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { bboxRadius: number } }).inspect().bboxRadius);
		await this.pollUntilStable(
			page,
			250,
			16,
			radius,
			(now, prev) => Math.abs(now - prev) < 0.5,
			() => this.settle(page),
		);
	}

	/** Wait until a {match} node is present (a streamed arrival lands a beat after the store write), returns its bare id or null. */
	private async waitForNodePresent(page: Page, match: string): Promise<string | null> {
		for (let i = 0; i < 30; i++) {
			const id = await this.resolveNodeId(page, match);
			if (id) return id;
			await page.waitForTimeout(300);
		}
		return null;
	}

	/** Resolve a {match} handle (objectId `type:id`, a bare id, or a name substring) to the live node's bare id. */
	private async resolveNodeId(page: Page, match: string): Promise<string | null> {
		await this.waitForNodes(page, 1);
		const nodes = await page.evaluate(() =>
			Array.from((document.querySelector("shu-polymorphic-graph-view") as unknown as { nodeMap: Map<string, { id: string; type: string; name?: string }> }).nodeMap.values()).map(
				(n) => ({ id: n.id, type: n.type, name: n.name }),
			),
		);
		const t = nodes.find((n) => objectId(n.type, n.id) === match || n.id === match || (n.name && n.name.includes(match)));
		return t ? t.id : null;
	}

	/** The drawn graph's connectivity, read from the fed library data (the ground truth of what is on screen): every
	 *  drawn node id that no drawn link touches. */
	private async drawnConnectivity(): Promise<{ total: number; isolated: string[] }> {
		const page = await this.page();
		await this.settle(page);
		return page.evaluate(() => {
			const view = document.querySelector("shu-polymorphic-graph-view") as unknown as {
				graph?: { graphData(): { nodes: Array<{ id: string }>; links: Array<{ source: string | { id: string }; target: string | { id: string } }> } };
			};
			const data = view.graph?.graphData() ?? { nodes: [], links: [] };
			const endId = (e: string | { id: string }): string => (typeof e === "string" ? e : e.id);
			const linked = new Set<string>();
			for (const l of data.links) {
				linked.add(endId(l.source));
				linked.add(endId(l.target));
			}
			return { total: data.nodes.length, isolated: data.nodes.filter((n) => !linked.has(n.id)).map((n) => n.id) };
		});
	}

	/** The predicates of the drawn edges: what the graph is showing, read once for whichever step asks. */
	private async drawnPredicates(): Promise<string[]> {
		const page = await this.page();
		await this.settle(page);
		return page.evaluate(() => {
			const view = document.querySelector("shu-polymorphic-graph-view") as unknown as { graph?: { graphData(): { links: Array<{ predicate: string }> } } };
			return (view.graph?.graphData().links ?? []).map((l) => l.predicate);
		});
	}

	/** Every chip the filter shows, across its groups: the chips live inside <shu-chip-group>'s own shadow root, so the
	 *  walk crosses one boundary and is written ONCE here rather than in each step that reads or presses a chip. */
	private chipStates(page: Page): Promise<Array<{ label: string; checked: boolean }>> {
		return page.evaluate(() => {
			const root = document.querySelector("shu-polymorphic-graph-view shu-graph-filter")?.shadowRoot;
			return Array.from(root?.querySelectorAll("shu-chip-group") ?? [])
				.flatMap((g) => Array.from(g.shadowRoot?.querySelectorAll("label.chip") ?? []))
				.map((chip) => ({ label: (chip.textContent ?? "").trim(), checked: !!(chip.querySelector("input") as HTMLInputElement | null)?.checked }));
		});
	}

	/** Drive a method on the live component: the one path a step, key, or button all share. */
	private async call(page: Page, op: string, args: unknown[]): Promise<void> {
		await page.evaluate(({ o, a }) => (document.querySelector("shu-polymorphic-graph-view") as unknown as Record<string, (...x: unknown[]) => void>)[o](...a), { o: op, a: args });
	}

	/** Project a node to canvas pixels (the real coordinate a pointer drag/hover hits). nudgeX nudges into a left-anchored
	 * chip's body (12 for a hover/click); the drag uses 0, pickNodeAt raycasts the BASE-scale sprite from its anchor. */
	/** Where the view draws a node, read from the view's own projection: the same one the pick inverts, so an aim here
	 *  lands on that node. `nudgeX` offsets the aim along x to clear a neighbour's chip. */
	private async projectNode(page: Page, id: string, nudgeX = 12): Promise<{ x: number; y: number }> {
		const at = await page.evaluate(
			(nid) =>
				(document.querySelector("shu-polymorphic-graph-view") as unknown as { projectNodeToScreen(i: string): { x: number; y: number } | null })?.projectNodeToScreen(nid) ?? null,
			id,
		);
		if (!at) throw new Error(`node ${id} has no projection, absent from the graph, or the scene has no camera yet`);
		return { x: at.x + nudgeX, y: at.y };
	}

	/** What changed between two graph snapshots (plus the hovered node's magnify k), empty = the graph is unchanged.
	 *  Reports each moved signal so a "graph changed on hover/click" regression is diagnosable: scale, zoom, camera, layout. */
	private graphMoved(before: Snapshot, after: Snapshot, k: number): string[] {
		const problems: string[] = [];
		if (k > 1.05) problems.push(`node magnified ${k.toFixed(2)}×`);
		if (before.viewport && after.viewport) {
			const zoom = Math.abs(after.viewport.worldPerPx - before.viewport.worldPerPx) / before.viewport.worldPerPx;
			if (zoom > 0.02) problems.push(`zoom (worldPerPx) shifted ${(zoom * 100).toFixed(0)}%`);
		}
		if (before.camera && after.camera) {
			const cam = Math.hypot(after.camera.x - before.camera.x, after.camera.y - before.camera.y, after.camera.z - before.camera.z);
			if (cam > 1) problems.push(`camera moved ${cam.toFixed(1)}`);
		}
		let maxMove = 0;
		for (const nid of Object.keys(before.pos)) {
			const b = before.pos[nid];
			const a = after.pos[nid];
			if (b && a) maxMove = Math.max(maxMove, Math.hypot(a.x - b.x, a.y - b.y));
		}
		if (maxMove > 1) problems.push(`a node moved ${maxMove.toFixed(1)} (layout reheat)`);
		return problems;
	}

	/** The hovered node's live magnify multiplier (1 = resting). */
	private hoveredK(page: Page, id: string): Promise<number> {
		return page.evaluate(
			(nid) =>
				(document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { sample: Array<{ id: string; k: number }> } }).inspect().sample.find((s) => s.id === nid)
					?.k ?? 1,
			id,
		);
	}

	steps: TStepperSteps = {
		waitForGraphNodes: {
			gwta: "graph has at least {count} nodes",
			action: async ({ count }: { count: string }) => {
				await this.waitForNodes(await this.page(), Number(count));
				return actionOK();
			},
		},
		waitForGraphNode: {
			// Wait for a specific node to stream in (a live arrival after a mid-run data write): the streamed-arrival witness.
			gwta: "graph shows node {match}",
			action: async ({ match }: { match: string }) => {
				const page = await this.page();
				const id = await this.waitForNodePresent(page, match);
				if (!id) return actionNotOK(`graph node "${match}" did not stream in`);
				await this.settle(page); // the arrival reheats the layout; wait for it to settle (and re-apply focus) before any assert
				await page.waitForTimeout(150); // applyFocus is scheduled a frame after the engine freezes
				return actionOK();
			},
		},
		clickGraphNode: {
			// Click a node via the production reveal path (openNode → onNodeClick) WITHOUT asserting a COLUMN_OPEN, in the
			// ontology view a node opens a windowed-instances pane (PANE_OPEN → filter-prop), not an entity column. The
			// column-browser stepper (activeColumnMatches) asserts which pane opened. NOT "click …": that collides with
			// web-playwright's generic "click {target}".
			gwta: "reveal graph node {match}",
			action: async ({ match }: { match: string }) => {
				const page = await this.page();
				const id = await this.resolveNodeId(page, match);
				if (!id) return actionNotOK(`graph node "${match}" not present`);
				await page.evaluate((nid) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { openNode(id: string): boolean }).openNode(nid), id);
				await page.waitForTimeout(500); // let the pane open + its graphQuery resolve + render
				return actionOK();
			},
		},
		filterToGraphType: {
			gwta: "filter to graph type {type}",
			action: async ({ type }: { type: string }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				const ok = await this.callGraphFilter(page, "setVisibleTypes", [[type]]);
				if (!ok) return actionNotOK("no graph filter on the view");
				await this.settleScopedRefetch(page);
				return actionOK();
			},
		},
		untickGraphTypes: {
			// Un-tick the named type chips, leaving every other type's visibility as it stands.
			gwta: "untick graph chips {types}",
			action: ({ types }: { types: string }) => this.setFilterChips("setTypeVisibility", types, false),
		},
		tickGraphTypes: {
			// The other half of the chip pair: tick the named type chips back on, leaving every other type as it stands.
			gwta: "tick graph chips {types}",
			action: ({ types }: { types: string }) => this.setFilterChips("setTypeVisibility", types, true),
		},
		soloTypeViaTool: {
			gwta: "solo graph type {type} via the 1️⃣ tool",
			action: async ({ type }: { type: string }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				const result = await page.evaluate((t) => {
					const root = document.querySelector("shu-polymorphic-graph-view shu-graph-filter")?.shadowRoot;
					if (!root) return "no graph filter";
					const btn = root.querySelector('[data-testid="graph-filter-solo"]') as HTMLButtonElement | null;
					if (!btn) return "no solo button";
					btn.click(); // select the tool, so the next chip click solos its type
					const chips = Array.from(root.querySelectorAll("shu-chip-group")).flatMap((g) => Array.from(g.shadowRoot?.querySelectorAll("label.chip") ?? []));
					const chip = chips.find((l) => (l.textContent ?? "").trim().startsWith(t)) as HTMLElement | undefined;
					if (!chip) return `no type chip for ${t}`;
					chip.click(); // tap the type → show only it
					return "ok";
				}, type);
				if (result !== "ok") return actionNotOK(result);
				await this.settleScopedRefetch(page);
				return actionOK();
			},
		},
		zoomGraph: {
			gwta: `zoom {dir: ${DOMAIN_GRAPH_ZOOM}} {amount} {unit: ${DOMAIN_GRAPH_UNIT}}`,
			action: async ({ dir, amount, unit }: { dir: string; amount: string; unit: string }) => {
				const page = await this.page();
				await this.settle(page);
				await this.call(page, "zoomBy", [Number(amount), unit, dir]);
				return actionOK();
			},
		},
		panGraph: {
			gwta: `pan {amount} {unit: ${DOMAIN_GRAPH_UNIT}} {dir: ${DOMAIN_GRAPH_PAN}}`,
			action: async ({ amount, unit, dir }: { amount: string; unit: string; dir: string }) => {
				const page = await this.page();
				await this.settle(page);
				await this.call(page, "panBy", [Number(amount), unit, dir]);
				return actionOK();
			},
		},
		orbitGraph: {
			gwta: `orbit {degrees} degrees {dir: ${DOMAIN_GRAPH_PAN}}`,
			action: async ({ degrees, dir }: { degrees: string; dir: string }) => {
				const page = await this.page();
				await this.settle(page);
				await this.call(page, "orbitBy", [Number(degrees), dir]);
				return actionOK();
			},
		},
		fitGraph: {
			gwta: "fit graph",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				await this.call(page, "fitGraph", []);
				return actionOK();
			},
		},
		toggleGraphFollow: {
			// The head's follow toggle, pressed as a person presses it. While on, the camera keeps the active (selected)
			// node centred and readable through selection changes and re-layouts.
			gwta: "toggle graph follow",
			action: async () => {
				const page = await this.page();
				const button = page.locator(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.FOLLOW}"]`);
				const was = (await button.getAttribute("aria-pressed")) === "true";
				await button.click();
				const now = (await button.getAttribute("aria-pressed")) === "true";
				if (now === was) return actionNotOK(`the follow toggle did not change state (aria-pressed stays ${now})`);
				return actionOK();
			},
		},
		untickGraphProperties: {
			// Un-tick predicate chips in the filter's properties group: those edges leave the model, so every medium
			// (the 3D view, the sequence, the still, the accessible document) draws the same reduced edge set.
			gwta: "untick graph properties {predicates}",
			action: ({ predicates }: { predicates: string }) => this.setFilterChips("setPredicateVisibility", predicates, false),
		},
		tickGraphProperties: {
			gwta: "tick graph properties {predicates}",
			action: ({ predicates }: { predicates: string }) => this.setFilterChips("setPredicateVisibility", predicates, true),
		},
		graphDrawsProperty: {
			gwta: "graph draws a {predicate} edge",
			action: async ({ predicate }: { predicate: string }) => {
				const drawn = await this.drawnPredicates();
				return drawn.includes(predicate) ? actionOK() : actionNotOK(`the graph draws no "${predicate}" edge (it draws ${[...new Set(drawn)].join(", ") || "nothing"})`);
			},
		},
		toggleGraphPrune: {
			// The head's prune toggle: nodes without a visible edge leave the model, in every medium.
			gwta: "toggle graph prune",
			action: async () => {
				const page = await this.page();
				await page.locator(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.PRUNE}"]`).click();
				await this.settle(page);
				return actionOK();
			},
		},
		graphCentresActive: {
			// Follow's observable contract: the active node projects inside the central half of the canvas.
			gwta: "graph centres the active node {name}",
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				const id = this.opened.get(name) ?? (await this.resolveNodeId(page, name));
				if (!id) return actionNotOK(`no graph node "${name}"`);
				await this.settle(page);
				await this.settleNodeProjection(page, id); // the follow re-frame animates after the engine freezes
				const at = await this.projectNode(page, id, 0); // client (page) coordinates: the same space the pointer uses
				const rect = await this.rectOf(page, SHU_TEST_IDS.POLYMORPHIC_VIEW.GRAPH_CONTAINER);
				if (!rect) return actionNotOK("no graph container to measure against");
				const dx = Math.abs(at.x - (rect.x + rect.w / 2));
				const dy = Math.abs(at.y - (rect.y + rect.h / 2));
				if (dx > rect.w / 4 || dy > rect.h / 4) {
					const s = await this.snapshot(page);
					return actionNotOK(`active node "${id}" projects (${dx.toFixed(0)},${dy.toFixed(0)}) from the canvas centre of ${rect.w}×${rect.h}; camera=${JSON.stringify(s.camera)}`);
				}
				return actionOK();
			},
		},
		clickGuideEntry: {
			// The guide's own activation path: a real click on the reading's entry for a node, focus lands in the guide
			// (which is what makes the follow aim beside it), and the click drives the same open a pointer on the canvas does.
			gwta: "open guide entry {match} as {name}",
			action: async ({ match, name }: { match: string; name: string }) => {
				const page = await this.page();
				await this.settle(page);
				const id = await this.resolveNodeId(page, match);
				if (!id) return actionNotOK(`graph node "${match}" not present`);
				const sel = `[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y}"] ol > li > [data-node-id="${id}"]`;
				const entry = page.locator(sel).first();
				if ((await entry.count()) === 0) return actionNotOK(`the guide lists no entry for "${id}"`);
				await entry.click();
				this.opened.set(name, id);
				return actionOK();
			},
		},
		graphActiveInClear: {
			// Following with the guide on screen: the chosen node lands ON the canvas and OUT from under the guide: the
			// clear strip beside it. Centred under a mostly-covering overlay, or pushed past the edge by a column-open
			// resize, the reader was shown nothing.
			gwta: "graph shows the active node {name} clear of the guide",
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				const id = this.opened.get(name) ?? (await this.resolveNodeId(page, name));
				if (!id) return actionNotOK(`no graph node "${name}"`);
				await this.settle(page);
				await this.settleNodeProjection(page, id);
				const at = await this.projectNode(page, id, 0);
				const canvas = await this.rectOf(page, SHU_TEST_IDS.POLYMORPHIC_VIEW.GRAPH_CONTAINER);
				const guide = await this.rectOf(page, SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y);
				if (!canvas) return actionNotOK("no graph container to measure against");
				if (at.x < canvas.x || at.x > canvas.x + canvas.w || at.y < canvas.y || at.y > canvas.y + canvas.h)
					return actionNotOK(`active node "${id}" projects (${at.x.toFixed(0)},${at.y.toFixed(0)}) off the ${canvas.w}×${canvas.h} canvas at (${canvas.x},${canvas.y})`);
				if (guide && at.x >= guide.x && at.x <= guide.x + guide.w && at.y >= guide.y && at.y <= guide.y + guide.h)
					return actionNotOK(`active node "${id}" sits under the guide (${guide.w.toFixed(0)}×${guide.h.toFixed(0)} at ${guide.x.toFixed(0)},${guide.y.toFixed(0)})`);
				return actionOK();
			},
		},
		graphOnlyConnected: {
			gwta: "graph shows only connected nodes",
			action: async () => {
				const { total, isolated } = await this.drawnConnectivity();
				if (total === 0) return actionNotOK("no nodes drawn: nothing to judge");
				return isolated.length === 0 ? actionOK() : actionNotOK(`isolated node(s) drawn under connected-only: ${isolated.join(", ")}`);
			},
		},
		fitGraphAround: {
			// Frame a node + its 1-hop neighbours so a doc/tour feature can jump straight to a node's local context.
			gwta: "fit graph around {node}",
			action: async ({ node }: { node: string }) => {
				const page = await this.page();
				const id = this.opened.get(node) ?? (await this.resolveNodeId(page, node));
				if (!id) return actionNotOK(`no graph node "${node}"`);
				await this.settle(page);
				await this.call(page, "fitGraphAround", [id]);
				return actionOK();
			},
		},
		openGraphNode: {
			// Open a node's column via the production reveal path (onNodeClick → COLUMN_OPEN) and prove the graph
			// emitted open-for-that-node. Remember it by {name} so a later hover can target the same node.
			gwta: "open graph node {match} as {name}",
			action: async ({ match, name }: { match: string; name: string }) => {
				const page = await this.page();
				await this.settle(page);
				const id = await this.resolveNodeId(page, match);
				if (!id) return actionNotOK(`graph node "${match}" not present`);
				const subject = await page.evaluate(
					({ nid, evt }) => {
						const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { openNode(id: string): boolean };
						(window as unknown as { __colOpen: Array<{ subject?: string }> }).__colOpen = [];
						document.addEventListener(evt, (e) => (window as unknown as { __colOpen: Array<{ subject?: string }> }).__colOpen.push((e as CustomEvent).detail), {
							once: true,
							capture: true,
						});
						el.openNode(nid);
						return (window as unknown as { __colOpen: Array<{ subject?: string }> }).__colOpen[0]?.subject ?? null;
					},
					{ nid: id, evt: COLUMN_OPEN },
				);
				if (subject !== id) return actionNotOK(`opening graph node "${id}" did not emit COLUMN_OPEN for it (got subject=${subject})`);
				this.opened.set(name, id);
				// Selection round-trips through the shared selection system (COLUMN_OPEN → app → selection signal → onGraphSelection),
				// so the node becomes the focused/selected subject a beat later. Wait for it, so a downstream focus assert never races.
				await page
					.waitForFunction(
						(nid) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { focus: { selected: string | null } } }).inspect().focus.selected === nid,
						id,
						{
							timeout: 5000,
						},
					)
					.catch((): undefined => undefined);
				await page.waitForTimeout(400); // let the column render + the polymorphic view's column-resize settle before any framing check
				return actionOK();
			},
		},
		hoverNode: {
			gwta: "hover the {name} node",
			action: async ({ name }: { name: string }) => {
				const id = this.opened.get(name);
				if (!id) return actionNotOK(`no graph node remembered as "${name}"`);
				await this.call(await this.page(), "setHoveredNode", [id]);
				return actionOK();
			},
		},
		movePointerOff: {
			// Clear the hover while the node stays selected and its column active: the user's exact "moved off the
			// focus node, still the active column but no longer hovered" sequence, which must not shift the framing.
			gwta: "move the pointer off the graph",
			action: async () => {
				await this.call(await this.page(), "setHoveredNode", [null]);
				return actionOK();
			},
		},
		hoverDoesNotMagnify: {
			// The hover pop must be a SIMPLE, BOUNDED step (the user's spec): a node smaller than readable pops UP toward a
			// readable size but NEVER huge (capped at MAX_MAGNIFY), it moves ONLY the node's own scale (never the camera, zoom,
			// or layout), and it reverts to resting size when the pointer leaves. Guards the "hover pops everything to a huge
			// size" regression. (Passing k=1 to graphMoved skips the scale check, so it asserts only camera/zoom/positions.)
			gwta: "hovering a node pops it no larger than readable and reverts",
			action: async () => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				await this.waitForLayoutStable(page); // the load-time auto-fit follows the spreading layout; only once it rests is the camera fixed
				const before = await this.snapshot(page);
				const id = await page.evaluate(
					() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { sample: { id: string }[] } }).inspect().sample[0]?.id ?? null,
				);
				if (!id) return actionNotOK("no node to hover");
				await this.call(page, "setHoveredNode", [id]);
				await page.waitForTimeout(700); // past MAGNIFY_MS: the pop has animated in by now
				const k = await this.hoveredK(page, id);
				if (k > HOVER_POP_MAX) return actionNotOK(`hover popped the node to ${k.toFixed(1)}×, far past a readable size; the pop must stay bounded`);
				const moved = this.graphMoved(before, await this.snapshot(page), 1);
				if (moved.length) return actionNotOK(`hover moved the view/layout: ${moved.join("; ")}: a hover must scale only the node`);
				await this.call(page, "setHoveredNode", [null]);
				await page.waitForTimeout(700);
				const off = await this.hoveredK(page, id);
				return off <= 1.05 ? actionOK() : actionNotOK(`node stayed magnified ${off.toFixed(2)}× after move-off, must revert to resting size`);
			},
		},
		realPointerHoverIsCalm: {
			// The PROPER hover test. The user's bug is the CAMERA/zoom/layout drifting while a real pointer rests/moves over
			// the graph. A real page.mouse.move over a node DOES pop that node (the intended hover magnify: troika's Mesh chips
			// ARE hit by the lib's hover raycaster, unlike the old SpriteText sprites synthetic events couldn't reach): that
			// per-node pop is fine as long as it stays readable-bounded. So jiggle a real pointer over the first node and assert
			// the pop stays bounded AND the framing (camera/zoom/positions) holds: the node's own pop is NOT a graph move.
			gwta: "moving the real pointer over the graph does not move the camera",
			action: async () => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				await this.waitForLayoutStable(page); // the camera is only fixed once the load-time auto-fit has stopped following the spreading layout
				const id = await page.evaluate(
					() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { sample: { id: string }[] } }).inspect().sample[0]?.id ?? null,
				);
				if (!id) return actionNotOK("no node to hover");
				const c = await this.projectNode(page, id);
				await page.mouse.move(c.x - 20, c.y); // pointer onto the canvas → sets pointerOverCanvas via the canvas pointermove handler
				await this.pollUntilStable(
					page,
					100,
					15,
					() => this.hoveredK(page, id),
					(now, prev) => Math.abs(now - prev) < 0.01,
				); // settle any residual magnify before the baseline
				const before = await this.snapshot(page);
				const kBefore = await this.hoveredK(page, id);
				for (let i = 0; i < 16; i++) {
					// jiggle a REAL pointer over the node for ~1.3s: the user's hover condition (no button)
					await page.mouse.move(c.x + (i % 2 ? 5 : -5), c.y + (i % 3 ? 3 : -3));
					await page.waitForTimeout(80);
				}
				const pop = 1 + Math.max(0, (await this.hoveredK(page, id)) - kBefore);
				if (pop > HOVER_POP_MAX) return actionNotOK(`real pointer popped the node ${pop.toFixed(2)}×, past a readable size`);
				// The node's own bounded hover-pop is intended; feed graphMoved k=1 so ONLY a camera/zoom/layout drift fails.
				const problems = this.graphMoved(before, await this.snapshot(page), 1);
				return problems.length === 0 ? actionOK() : actionNotOK(`real pointer over the graph moved it: ${problems.join("; ")}`);
			},
		},
		rememberGraph: {
			gwta: "remember the graph as {name}",
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				await this.waitForLayoutStable(page); // baseline a SETTLED graph: the auto-fit follows the spreading layout, so a mid-spread baseline would read as a later "re-frame"
				await this.waitForCalibratedViewport(page);
				this.snapshots.set(name, await this.snapshot(page));
				return actionOK();
			},
		},
		graphView: {
			// The framing assertion, both directions in one step. "unchanged" is the auto-zoom guard: fov, camera
			// position, and the zoom level (worldPerPx) all held since the snapshot, used after a click/hover/move-off,
			// where the graph must NOT re-decide its own framing. "changed" confirms a sanctioned pan/orbit/fit moved it.
			// Node positions are not checked: opening a node may legitimately bring in data; only the framing is pinned.
			gwta: `graph view is {state: ${DOMAIN_GRAPH_CHANGE}} since {name}`,
			action: async ({ state, name }: { state: string; name: string }) => {
				const before = this.snapshots.get(name);
				if (!before?.camera || !before.viewport) return actionNotOK(`no remembered graph snapshot "${name}"`);
				const page = await this.page();
				await this.waitForCalibratedViewport(page);
				const after = await this.snapshot(page);
				if (!after.camera || !after.viewport) return actionNotOK("no live framing");
				// The zoom LEVEL is worldPerPx, not fov: fov is ALLOWED to change to hold worldPerPx across a box-height
				// change (the no-auto-zoom compensation). A re-frame is a camera-position move (pan/orbit/fit) or a real
				// worldPerPx change (a zoom), never the fov adjustment that keeps content the same apparent size.
				const camDrift = Math.hypot(after.camera.x - before.camera.x, after.camera.y - before.camera.y, after.camera.z - before.camera.z);
				const zoomDrift = Math.abs(after.viewport.worldPerPx - before.viewport.worldPerPx) / before.viewport.worldPerPx;
				const moved = camDrift > 1 || zoomDrift > 0.01;
				if (state === "unchanged")
					return moved
						? actionNotOK(
								`graph re-framed itself since "${name}": posΔ=${camDrift.toFixed(2)} zoomΔ=${(zoomDrift * 100).toFixed(1)}% (canvas h ${before.viewport.h}→${after.viewport.h}): it must not auto-zoom`,
							)
						: actionOK();
				return moved ? actionOK() : actionNotOK(`graph view did not change since "${name}" (posΔ=${camDrift.toFixed(2)} zoomΔ=${(zoomDrift * 100).toFixed(1)}%)`);
			},
		},
		graphLayoutSteady: {
			// Node WORLD positions barely moved since the snapshot: the layout did not wiggle/reheat. This is the
			// "bananas" guard, distinct from framing: the camera can hold steady while nodes churn under rapid focus switches.
			gwta: "graph layout is steady since {name}",
			action: async ({ name }: { name: string }) => {
				const before = this.snapshots.get(name);
				if (!before) return actionNotOK(`no remembered graph snapshot "${name}"`);
				const after = await this.snapshot(await this.page());
				let maxDrift = 0;
				let worst = "";
				for (const id of Object.keys(before.pos)) {
					const a = after.pos[id];
					if (!a) continue;
					// All three axes: a uniform depth shift (the z-recentre defect) moved every node while the x/y check read "steady".
					const d = Math.hypot(a.x - before.pos[id].x, a.y - before.pos[id].y, a.z - before.pos[id].z);
					if (d > maxDrift) {
						maxDrift = d;
						worst = id;
					}
				}
				return maxDrift <= 2 ? actionOK() : actionNotOK(`graph layout moved since "${name}" (node ${worst} drifted ${maxDrift.toFixed(2)}), switching focus disturbed the layout`);
			},
		},
		graphZoom: {
			gwta: `graph zoom is {comparison: ${DOMAIN_GRAPH_ZOOM_CMP}} than {name}`,
			action: async ({ comparison, name }: { comparison: string; name: string }) => {
				const before = this.snapshots.get(name);
				if (!before?.viewport) return actionNotOK(`no remembered graph snapshot "${name}"`);
				const after = await this.snapshot(await this.page());
				if (!after.viewport) return actionNotOK("no live viewport");
				const ratio = after.viewport.worldPerPx / before.viewport.worldPerPx; // worldPerPx smaller = closer (more zoomed in)
				if (comparison === "closer") return ratio < 0.99 ? actionOK() : actionNotOK(`graph did not zoom in since "${name}" (worldPerPx ×${ratio.toFixed(3)})`);
				return ratio > 1.01 ? actionOK() : actionNotOK(`graph did not zoom out since "${name}" (worldPerPx ×${ratio.toFixed(3)})`);
			},
		},
		focusFirstNode: {
			// Focus the first node WITHOUT settling first, reproduces a focus during/right after the initial render.
			gwta: "focus the first graph node",
			action: async () => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				const id = await page.evaluate(() => {
					const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { sample: { id: string }[] } };
					return el.inspect().sample[0]?.id ?? null;
				});
				if (!id) return actionNotOK("no node to focus");
				await this.call(page, "setHoveredNode", [id]);
				return actionOK();
			},
		},
		graphFitsView: {
			// The whole graph is framed on screen: the "it rendered but nothing is visible" guard. Reads the share of
			// nodes whose world position projects inside the canvas; a low share means the camera is not framing the
			// settled graph (the unframed-after-async-solve failure).
			gwta: "graph fits the view",
			action: async () => {
				const page = await this.page();
				await this.waitForLayoutStable(page); // the auto-fit frames the graph as it spreads; assert only once that spread has finished
				const m = await page.evaluate(
					() =>
						(
							document.querySelector("shu-polymorphic-graph-view") as unknown as {
								inspect(): { onScreen: { fraction: number; onScreen: number; total: number; span: number } | null };
							}
						).inspect().onScreen,
				);
				if (!m) return actionNotOK("no framing metric, camera not ready");
				if (m.fraction < 0.9)
					return actionNotOK(`graph not framed: ${m.onScreen}/${m.total} nodes on screen (${(m.fraction * 100).toFixed(0)}%): the camera must frame the whole graph`);
				// On screen but a tiny dot is still "nothing visible": require the graph to fill a meaningful share of the view.
				if (m.span < 0.2) return actionNotOK(`graph too small: it spans only ${(m.span * 100).toFixed(0)}% of the view: the camera must frame it at a usable size`);
				return actionOK();
			},
		},
		dragGraphNode: {
			// A real press-drag-release through the polymorphic view's own pointer handlers (which DO receive synthetic pointer events,
			// unlike the lib's click raycaster). Deterministic: it drags whichever node the view reports DRAGGABLE (un-occluded)
			// rather than a fixed id: the frontmost node is always pickable, so a non-deterministic layout can't leave the
			// target buried. The drag GEOMETRY (track/pin/release) is unit-tested in polymorphic-drag.test.ts; this only smoke-tests
			// the DOM→handler wiring: the dragged node tracks the pointer + pins, others hold still. Remembered under {name}.
			gwta: "drag a node as {name}",
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				const { target, diag } = await this.pressFirstDraggable(page);
				if (!target) return actionNotOK(`no draggable node, ${diag}`);
				this.opened.set(name, target.id); // remember which node was dragged so a later pin-check can target it
				const before = await this.fullInspect(page); // after the press (which moves nothing), so "others hold still" measures only the drag
				await page.mouse.move(target.x + 120, target.y + 60, { steps: 8 }); // well past the drag threshold (pointer already down on the node)
				await page.mouse.up();
				await page.waitForTimeout(200);
				const after = await this.fullInspect(page);
				const moved = dist(before.sample, after.sample, target.id);
				if (moved <= 15) return actionNotOK(`the dragged node "${target.id}" did not track the pointer (moved ${moved.toFixed(1)})`);
				const others = after.sample.filter((s) => s.id !== target.id).reduce((m, s) => Math.max(m, dist(before.sample, after.sample, s.id)), 0);
				if (others > 2) return actionNotOK(`a non-dragged node moved ${others.toFixed(1)} during the drag`);
				const dropped = after.sample.find((s) => s.id === target.id);
				if (dropped?.fx == null) return actionNotOK(`the dragged node "${target.id}" was not pinned on release`);
				this.droppedAt.set(name, { x: dropped.x, y: dropped.y });
				return actionOK();
			},
		},
		setFlatten: {
			// Toggle the flat (2D) layout via the production control (the #polymorphic-flatten checkbox). One step, both
			// directions, matching setGrouping's shape. Flat is a saved-view choice like any other, so a scene captures it.
			// The tail names the layout, not just "the graph": a leading slot matches any word, so a plainer tail would
			// collide with every prose line ending in "the graph".
			gwta: `{toggle: ${DOMAIN_GRAPH_FLATTEN}} the graph layout`,
			action: async ({ toggle }: { toggle: string }) => {
				const page = await this.page();
				const on = toggle === "flatten";
				await this.openSettings(page, "layout");
				const ok = await page.evaluate(
					({ want, flattenId }) => {
						const cb = document.querySelector(`shu-polymorphic-graph-view [data-testid='${flattenId}']`) as HTMLInputElement | null;
						if (!cb) return false;
						if (cb.checked !== want) {
							cb.checked = want;
							cb.dispatchEvent(new Event("change", { bubbles: true }));
						}
						return true;
					},
					{ want: on, flattenId: POLYMORPHIC_IDS.FLATTEN },
				);
				if (!ok) return actionNotOK("no flatten toggle on the view");
				await this.settle(page); // the toggle schedules the debounced relayout synchronously; settle waits for it
				return actionOK();
			},
		},
		setGrouping: {
			// Toggle grouped mode via the production control (the #polymorphic-grouped checkbox). One step, both directions:
			// "group the graph" / "ungroup the graph". When grouping on, wait for the enclosure boxes (drawn a frame after rest).
			gwta: `{toggle: ${DOMAIN_GRAPH_GROUPING}} the graph by type`,
			action: async ({ toggle }: { toggle: string }) => {
				const page = await this.page();
				const on = toggle === "group";
				await this.openSettings(page, "layout");
				const ok = await page.evaluate(
					({ want, groupedId }) => {
						const cb = document.querySelector(`shu-polymorphic-graph-view [data-testid='${groupedId}']`) as HTMLInputElement | null;
						if (!cb) return false;
						if (cb.checked !== want) {
							cb.checked = want;
							cb.dispatchEvent(new Event("change", { bubbles: true }));
						}
						return true;
					},
					{ want: on, groupedId: POLYMORPHIC_IDS.GROUPED },
				);
				if (!ok) return actionNotOK("no grouped toggle on the view");
				await this.settle(page); // the toggle schedules the debounced relayout synchronously; settle waits for it
				if (on) {
					// Enclosure boxes are drawn a frame or two AFTER the layout settles (updateEnclosureGeometry on rest).
					await page
						.waitForFunction(
							(): boolean => {
								const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { enclosures: unknown[] } } | null;
								return !!el && el.inspect().enclosures.length > 0;
							},
							undefined,
							{ timeout: 8000 },
						)
						.catch((): undefined => undefined);
				}
				return actionOK();
			},
		},
		groupGraphBy: {
			// Group the graph by an axis: turn grouping on AND switch the group-by select via the production controls
			// (#polymorphic-grouped + #polymorphic-group-by), then wait for the group containers to draw. One step for every axis;
			// "role" is the trust-triangle party axis, "type" the @type axis.
			gwta: `group the graph by {axis: ${DOMAIN_GRAPH_GROUP_AXIS}}`,
			action: async ({ axis }: { axis: string }) => {
				const page = await this.page();
				await this.openSettings(page, "layout");
				const ok = await page.evaluate(
					({ want, groupedId, groupById }) => {
						const root = document.querySelector("shu-polymorphic-graph-view");
						const cb = root?.querySelector(`[data-testid='${groupedId}']`) as HTMLInputElement | null;
						const sel = root?.querySelector(`[data-testid='${groupById}']`) as HTMLSelectElement | null;
						if (!cb || !sel) return false;
						if (!cb.checked) {
							cb.checked = true;
							cb.dispatchEvent(new Event("change", { bubbles: true }));
						}
						if (sel.value !== want) {
							sel.value = want;
							sel.dispatchEvent(new Event("change", { bubbles: true }));
						}
						return true;
					},
					{ want: axis, groupedId: POLYMORPHIC_IDS.GROUPED, groupById: POLYMORPHIC_IDS.GROUP_BY },
				);
				if (!ok) return actionNotOK("no grouped / group-by controls on the view");
				await this.settle(page); // the controls schedule the debounced relayout synchronously; settle waits for it
				// Group containers are drawn a frame or two after the layout settles.
				await page
					.waitForFunction(
						(): boolean => {
							const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { enclosures: unknown[] } } | null;
							return !!el && el.inspect().enclosures.length > 0;
						},
						undefined,
						{ timeout: 8000 },
					)
					.catch((): undefined => undefined);
				return actionOK();
			},
		},
		switchGraphView: {
			// Switch the graph's render type via the production control (the view tabs), exactly as a person clicking
			// one does, then wait for the relayout tween + camera re-aim to settle. One step for every render type so a
			// feature can step force → sequence → gantt → force and prove the switching is clean (no stuck state).
			gwta: `show the graph as a {view: ${DOMAIN_GRAPH_VIEW}} graph`,
			action: async ({ view }: { view: string }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				const ok = await this.selectView(page, view);
				if (!ok) return actionNotOK("no view-type control on the graph");
				await page.waitForTimeout(500); // the view switch is a debounced relayout tween
				await this.settle(page);
				const got = await page.evaluate(() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { viewType: string } }).inspect().viewType);
				return got === view ? actionOK() : actionNotOK(`view-type did not switch to "${view}" (got "${got}")`);
			},
		},
		graphPlacesGanttTasks: {
			// The gantt calendar places one task per subject carrying a start-kind time (an interval when it also carries an
			// end, a point milestone otherwise). Asserted from inspect().gantt: the same cached scale/targets the ruler and
			// bar placement read, so a passing count means the calendar laid out.
			gwta: "graph places at least {count} gantt tasks",
			action: async ({ count }: { count: string }) => {
				const page = await this.page();
				await this.settle(page);
				const gantt = await page.evaluate(
					() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { gantt: { from: string; to: string; count: number } | null } }).inspect().gantt,
				);
				if (!gantt) return actionNotOK("no gantt placement: the calendar laid out no tasks");
				if (gantt.count < Number(count)) return actionNotOK(`only ${gantt.count} gantt task(s) placed (${gantt.from} → ${gantt.to}), expected at least ${count}`);
				return actionOK();
			},
		},
		graphCameraFacesLanePlane: {
			// The lane views aim the camera along +x so time lies horizontal, asserted from the camera position itself:
			// the x offset dominates depth. A gantt that "switched" without re-aiming leaves the camera on the force frame.
			gwta: "graph camera faces the lane plane",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				// The lane reframe applies on the settle that has the placed bars; poll for the x-dominant aim rather than
				// reading once, so a settle observed a beat before the reframe applies does not read the prior framing.
				try {
					await page.waitForFunction(
						() => {
							const c = (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { camera: { x: number; z: number } } }).inspect().camera;
							return Math.abs(c.x) > Math.abs(c.z);
						},
						undefined,
						{ timeout: 5000 },
					);
				} catch {
					const cam = await page.evaluate(
						() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { camera: { x: number; z: number } } }).inspect().camera,
					);
					return actionNotOK(`camera is not on the lane-plane aim (x ${Math.round(cam.x)}, z ${Math.round(cam.z)})`);
				}
				return actionOK();
			},
		},
		graphPlacesOnLanePlane: {
			// A lane view (gantt, sequence) draws on ONE plane and the camera faces it, so every node it shows must sit on
			// that plane: a node left off it is scattered by perspective: the same lane and time, a different place on
			// screen. Reads the drawn positions, since the pin is what the layout applied.
			gwta: "graph places every node on the lane plane",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				const wrong = await page.evaluate(() => {
					const view = document.querySelector("shu-polymorphic-graph-view") as unknown as {
						inspect(): { sample: Array<{ id: string; x: number; y: number; z: number }>; sequence: { nodes: Array<{ id: string; y: number; z: number }> } | null };
					};
					const i = view.inspect();
					const drawn = new Map(i.sample.map((n) => [n.id, n]));
					const out: string[] = [];
					for (const n of i.sample) if (Math.abs(n.x) > 1) out.push(`${n.id} off the plane at x=${n.x.toFixed(0)}`);
					// The placement the view computed IS where the node must be drawn; a gap means the layout never applied it.
					for (const p of i.sequence?.nodes ?? []) {
						const d = drawn.get(p.id);
						if (!d) continue;
						if (Math.abs(d.y - p.y) > 1 || Math.abs(d.z - p.z) > 1)
							out.push(`${p.id} drawn at (${d.y.toFixed(0)},${d.z.toFixed(0)}) but placed at (${p.y.toFixed(0)},${p.z.toFixed(0)})`);
					}
					return out;
				});
				return wrong.length === 0 ? actionOK() : actionNotOK(`${wrong.length} node(s) are not where the view placed them: ${wrong.slice(0, 5).join("; ")}`);
			},
		},
		graphRevealsActors: {
			// Choosing the sequence shows the types its bars are drawn from: a hidden actor type would leave the exchange
			// with nobody in it. Hides whatever types the actors belong to, leaves the view and comes back, and asks the
			// filter: the production path a reader takes, with no type named here.
			gwta: "switching to the sequence reveals its actor types",
			action: async () => {
				const page = await this.page();
				await this.selectView(page, "sequence");
				await this.settle(page);
				const actorTypes = await page.evaluate(() => {
					const view = document.querySelector("shu-polymorphic-graph-view") as unknown as {
						inspect(): { sample: Array<{ id: string; type: string }>; sequence: { actors: Array<{ id: string }> } | null };
					};
					const i = view.inspect();
					const typeOf = new Map(i.sample.map((n) => [n.id, n.type]));
					return [...new Set((i.sequence?.actors ?? []).map((a) => typeOf.get(a.id)).filter((t): t is string => !!t))];
				});
				if (actorTypes.length === 0) return actionNotOK("the sequence formed no actors, so there is no actor type to reveal");
				await this.selectView(page, "force");
				const hide = await this.setFilterChips("setTypeVisibility", actorTypes.join(","), false);
				if (!hide.ok) return hide;
				await this.selectView(page, "sequence");
				await this.settle(page);
				const chips = await this.chipStates(page);
				const state = actorTypes.map((t) => ({ type: t, shown: chips.find((c) => c.label.startsWith(t))?.checked ?? null }));
				const left = state.filter((s) => s.shown !== true).map((s) => s.type);
				return left.length === 0 ? actionOK() : actionNotOK(`the sequence left ${left.join(", ")} hidden, so its bars have nobody to draw`);
			},
		},
		graphFormsSequenceActors: {
			// The 3D sequence view derives one ACTOR per distinct participant (the merged role) from the graph: no hand-
			// applied labels. Assert at least {count} actors formed in inspect().sequence, the ground truth the lifelines
			// are drawn from (the lifeline pillars themselves are a 3D overlay, asserted via the lane placement below).
			gwta: "graph shows at least {count} sequence actors",
			action: async ({ count }: { count: string }) => {
				const page = await this.page();
				await this.settle(page);
				const actors = await page.evaluate(
					() =>
						(document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { sequence: { actors: Array<{ id: string; label: string }> } | null } }).inspect()
							.sequence?.actors ?? [],
				);
				if (actors.length < Number(count))
					return actionNotOK(`only ${actors.length} sequence actor(s) formed [${actors.map((a) => a.label).join(", ")}], expected at least ${count}`);
				return actionOK();
			},
		},
		settingsHoldEveryOption: {
			// Every option lives under its settings group and the ACTIONS do not: fit and copy stay directly on the head.
			// The groups are exclusive: opening one closes the last. Asserted in a real browser: a group's controls render
			// only while its row is open, which no jsdom test can tell apart from missing.
			gwta: "polymorphic settings hold every option, and fit stays out of them",
			action: async () => {
				const page = await this.page();
				const groups = (["layout", "scenes"] as const).map((group) => ({ group, ids: SETTINGS_CONTROLS[group] }));
				let closed = ""; // a control of the group opened last: opening another must take it off screen
				for (const { group, ids } of groups) {
					await this.openSettings(page, group);
					// ONE round trip per group: what its options show, whether the last group's went away, and whether the
					// actions are still on the head.
					const seen = await page.evaluate(
						({ ids, closed, actionIds, viewTypeId }) => {
							const shown = (id: string) => !!(document.querySelector(`shu-polymorphic-graph-view [data-testid='${id}']`) as HTMLElement | null)?.checkVisibility();
							return {
								missing: ids.filter((id) => !shown(id)),
								stillShown: closed && shown(closed) ? closed : "",
								actionsGone: actionIds.filter((id) => !shown(id)),
								views: [...((document.querySelector(`shu-polymorphic-graph-view [data-testid='${viewTypeId}']`) as HTMLSelectElement | null)?.options ?? [])].map((o) => o.value),
							};
						},
						{ ids, closed, actionIds: [POLYMORPHIC_IDS.FIT, POLYMORPHIC_IDS.COPY_GRAPH] as string[], viewTypeId: POLYMORPHIC_IDS.VIEW_TYPE as string },
					);
					if (seen.missing.length) return actionNotOK(`option(s) not shown in the open ${group} group: ${seen.missing.join(", ")}`);
					if (seen.stillShown) return actionNotOK(`the groups are not exclusive: ${seen.stillShown} is still shown with ${group} open`);
					if (seen.actionsGone.length) return actionNotOK(`${seen.actionsGone.join(", ")} left the head with ${group} open: an action is always reachable`);
					if (group === "layout" && seen.views.join(",") !== VIEW_TYPES.join(","))
						return actionNotOK(`the view control offers [${seen.views.join(", ")}], not the full catalog [${VIEW_TYPES.join(", ")}]`);
					closed = ids[0];
				}
				return actionOK();
			},
		},
		sequenceSuppressesGroupingControls: {
			// The sequence is a 3D lane view (participants are lifelines, time is the z axis): its lifelines ARE the
			// grouping, so the generic group/group-by controls are hidden while the 3D scene stays shown. Assert the live
			// DOM: the grouping controls are gone and the scene container is present. (jsdom does no layout/shadow CSS, so
			// this must run in a real browser via the controls stepper.)
			gwta: "sequence hides the grouping controls and shows the 3D scene",
			action: async () => {
				const page = await this.page();
				// Open the settings first: with them closed EVERY option is absent, so "no grouping controls" would hold for
				// any view and the claim would be empty. Open, the absence is the sequence view's own doing.
				await this.openSettings(page, "layout");
				const dom = await page.evaluate(
					({ containerId, groupById, groupedId }) => {
						const root = document.querySelector("shu-polymorphic-graph-view");
						return {
							scene: !!root?.querySelector(`[data-testid='${containerId}'] a-scene`),
							viewType: (root as unknown as { inspect(): { viewType: string } }).inspect().viewType,
							groupBy: !!root?.querySelector(`[data-testid='${groupById}']`),
							grouped: !!root?.querySelector(`[data-testid='${groupedId}']`),
						};
					},
					{ containerId: POLYMORPHIC_IDS.GRAPH_CONTAINER, groupById: POLYMORPHIC_IDS.GROUP_BY, groupedId: POLYMORPHIC_IDS.GROUPED },
				);
				if (dom.viewType !== "sequence" || !dom.scene) return actionNotOK(`the 3D sequence scene is not shown (viewType=${dom.viewType}, scene=${dom.scene})`);
				if (dom.groupBy || dom.grouped)
					return actionNotOK(`grouping controls still shown in sequence (group-by=${dom.groupBy}, grouped=${dom.grouped}): a lane view's lifelines ARE its grouping`);
				return actionOK();
			},
		},
		classBrowserShowsSchema: {
			// The type column embeds the site's class browser (ui.presents "schema"): the schema as a live graph whose
			// legend offers exactly the Class + Property toggles: no instance types, no per-type limit or solo tool.
			gwta: "class browser in the type column shows only the schema",
			action: async () => {
				const page = await this.page();
				const state = await page.evaluate(async () => {
					const walk = (root: ParentNode, sel: string): Element | null => {
						const f = root.querySelector?.(sel);
						if (f) return f;
						for (const el of Array.from(root.querySelectorAll?.("*") ?? []))
							if (el.shadowRoot) {
								const g = walk(el.shadowRoot, sel);
								if (g) return g;
							}
						return null;
					};
					// The browser's first paints precede the schema scope (the reveal lands once the clusters are known), so
					// poll until the SCOPED state, only schema types rendered, and report the last state on timeout.
					let last: { chips: string[]; nodeTypes: string[]; limitControl: boolean } | null = null;
					for (let tries = 0; tries < 60; tries++) {
						const cb = walk(document, "shu-type-column")?.querySelector("shu-class-browser");
						const scene = cb?.querySelector("shu-graph-scene") as { nodeMap?: Map<string, { type: string }> } | null | undefined;
						const chips = Array.from(cb?.querySelector("shu-graph-filter")?.shadowRoot?.querySelectorAll("shu-chip-group") ?? [])
							.flatMap((g) => Array.from(g.shadowRoot?.querySelectorAll("label.chip") ?? []))
							.map((c) => c.textContent?.trim().split(" ")[0] ?? ""); // the class browser's OWN filter, not the polymorphic view's: its own root
						const nodes = scene?.nodeMap ? [...scene.nodeMap.values()] : [];
						if (chips.length && nodes.length) {
							last = {
								chips: chips.sort(),
								nodeTypes: [...new Set(nodes.map((n) => n.type))].sort(),
								limitControl: !!cb?.querySelector("shu-graph-filter")?.shadowRoot?.querySelector("[data-testid='graph-filter-limit-value']"),
							};
							if (last.nodeTypes.every((t) => t === "Class" || t === "Property")) return last;
						}
						await new Promise((r) => setTimeout(r, 250));
					}
					return last;
				});
				if (!state) return actionNotOK("the class browser never presented schema chips and nodes");
				if (state.chips.join(",") !== "Class,Property") return actionNotOK(`legend should offer exactly Class + Property, got: ${state.chips.join(", ")}`);
				if (state.limitControl) return actionNotOK("the schema legend must not carry the instance-data per-type limit");
				const nonSchema = state.nodeTypes.filter((t) => t !== "Class" && t !== "Property");
				return nonSchema.length === 0 ? actionOK() : actionNotOK(`non-schema types rendered in the class browser: ${nonSchema.join(", ")}`);
			},
		},
		classBrowserIndependent: {
			// The browser holds an independent snapshot scope: narrowing the MAIN graph to one type (its own filter's
			// production path) must not change what the class browser shows.
			gwta: "class browser is unaffected when the main graph filters to type {typeName}",
			action: async ({ typeName }: { typeName: string }) => {
				const page = await this.page();
				const result = await page.evaluate(async (t) => {
					const walk = (root: ParentNode, sel: string): Element | null => {
						const f = root.querySelector?.(sel);
						if (f) return f;
						for (const el of Array.from(root.querySelectorAll?.("*") ?? []))
							if (el.shadowRoot) {
								const g = walk(el.shadowRoot, sel);
								if (g) return g;
							}
						return null;
					};
					const scene = walk(document, "shu-type-column")?.querySelector("shu-class-browser")?.querySelector("shu-graph-scene") as unknown as {
						nodeMap: Map<string, unknown>;
					} | null;
					const main = walk(document, "shu-polymorphic-graph-view") as ({ nodeMap?: Map<string, unknown> } & Element) | null;
					if (!scene || !main) return { err: "class browser or main graph view absent" };
					// Both views boot from a fresh navigation; wait for each to hold its own nodes before measuring.
					for (let tries = 0; tries < 60 && (scene.nodeMap.size === 0 || (main.nodeMap?.size ?? 0) === 0); tries++) await new Promise((r) => setTimeout(r, 250));
					const before = scene.nodeMap.size;
					(main.querySelector("shu-graph-filter") as unknown as { setVisibleTypes(types: string[]): void } | null)?.setVisibleTypes([t]);
					await new Promise((r) => setTimeout(r, 3000)); // the main view refetches its own scope
					return { before, after: scene.nodeMap.size, main: main.nodeMap?.size ?? -1 };
				}, typeName);
				if ("err" in result) return actionNotOK(String(result.err));
				if (result.before === 0) return actionNotOK("the class browser had no nodes to compare");
				return result.after === result.before ? actionOK() : actionNotOK(`the main filter changed the class browser: ${result.before} → ${result.after} nodes`);
			},
		},
		classBrowserHighlights: {
			// The embedding column publishes its type as the shared selection: the type's Class node is highlighted within
			// the full schema: it and its incident neighbours (its properties, its superclass) stay lit, the rest dims.
			gwta: "class browser highlights {typeName} within the schema",
			action: async ({ typeName }: { typeName: string }) => {
				const page = await this.page();
				const state = await page.evaluate(async (t) => {
					const walk = (root: ParentNode, sel: string): Element | null => {
						const f = root.querySelector?.(sel);
						if (f) return f;
						for (const el of Array.from(root.querySelectorAll?.("*") ?? []))
							if (el.shadowRoot) {
								const g = walk(el.shadowRoot, sel);
								if (g) return g;
							}
						return null;
					};
					type Insp = {
						inspect(): { focus: { selected: string | null }; engineMode?: string; render?: { paused?: boolean }; sample: Array<{ opacity: number | null }> };
						nodeMap: Map<string, unknown>;
					};
					for (let tries = 0; tries < 40; tries++) {
						const scene = walk(document, "shu-type-column")?.querySelector("shu-class-browser")?.querySelector("shu-graph-scene") as unknown as Insp | null;
						if (scene?.nodeMap.has(t)) {
							const i = scene.inspect();
							const dim = i.sample.filter((n) => (n.opacity ?? 1) < 0.5).length;
							const lit = i.sample.filter((n) => (n.opacity ?? 1) > 0.9).length;
							if (i.focus.selected === t && dim > 0 && lit > 0) return { selected: i.focus.selected, dim, lit };
						}
						await new Promise((r) => setTimeout(r, 250));
					}
					const scene = walk(document, "shu-type-column")?.querySelector("shu-class-browser")?.querySelector("shu-graph-scene") as unknown as Insp | null;
					const i = scene?.inspect();
					const sample = i?.sample ?? [];
					return {
						selected: i?.focus.selected ?? null,
						dim: sample.filter((n) => (n.opacity ?? 1) < 0.5).length,
						lit: sample.filter((n) => (n.opacity ?? 1) > 0.9).length,
						has: scene?.nodeMap.has(t) ?? false,
						nodes: scene?.nodeMap.size ?? 0,
						sampled: sample.length,
						engineMode: i?.engineMode ?? "?",
						paused: i?.render?.paused ?? "?",
					};
				}, typeName);
				if (state.dim > 0 && state.lit > 0 && state.selected === typeName) return actionOK();
				return actionNotOK(
					`${typeName} is not highlighted within the schema (selected=${state.selected}, dim=${state.dim}, lit=${state.lit}, has=${"has" in state ? state.has : "?"}, nodes=${"nodes" in state ? state.nodes : "?"}, sampled=${"sampled" in state ? state.sampled : "?"}, engineMode=${"engineMode" in state ? state.engineMode : "?"}, paused=${"paused" in state ? state.paused : "?"})`,
				);
			},
		},
		sequenceHasMessages: {
			// The sequence's messages are the cross-participant edges, time-ordered. Assert at least {count} messages
			// formed in inspect().sequence: the ground truth the message arrows between lifelines are drawn from.
			gwta: "graph shows at least {count} sequence messages",
			action: async ({ count }: { count: string }) => {
				const page = await this.page();
				await this.settle(page);
				const messages = await page.evaluate(
					() =>
						(
							document.querySelector("shu-polymorphic-graph-view") as unknown as {
								inspect(): { sequence: { messages: Array<{ from: string; to: string; label: string }> } | null };
							}
						).inspect().sequence?.messages ?? [],
				);
				if (messages.length < Number(count))
					return actionNotOK(`only ${messages.length} sequence message(s) formed [${messages.map((m) => `${m.from}→${m.to}:${m.label}`).join("; ")}], expected at least ${count}`);
				return actionOK();
			},
		},
		saveGraphScene: {
			// Save the way the graph is currently set up under a name, through the production control (the settings' name
			// field + save button), the same path a reader takes, so the write goes through the app's own step RPC.
			gwta: "save graph scene as {name: string}",
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				await this.openSettings(page, "scenes");
				const ok = await page.evaluate(
					({ sceneName, nameId, saveId }) => {
						const view = document.querySelector("shu-polymorphic-graph-view");
						const input = view?.querySelector(`[data-testid='${nameId}']`) as HTMLInputElement | null;
						const save = view?.querySelector(`[data-testid='${saveId}']`) as HTMLButtonElement | null;
						if (!input || !save) return false;
						input.value = sceneName;
						save.click();
						return true;
					},
					{ sceneName: name, nameId: POLYMORPHIC_IDS.SCENE_NAME, saveId: POLYMORPHIC_IDS.SCENE_SAVE },
				);
				if (!ok) return actionNotOK("no scene controls on the view");
				// The save is a round trip; the scene appears in the picker when it lands.
				await page.waitForFunction(
					({ pickerId, sceneName }) => {
						const picker = document.querySelector("shu-polymorphic-graph-view")?.querySelector(`[data-testid='${pickerId}']`) as HTMLSelectElement | null;
						return !!picker && [...picker.options].some((option) => option.value === sceneName);
					},
					{ pickerId: POLYMORPHIC_IDS.SCENE_PICKER, sceneName: name },
					{ timeout: 10000 },
				);
				this.savedScenes.set(name, await this.captureGraphScene(page));
				return actionOK();
			},
		},
		applyGraphScene: {
			// Return the graph to a saved scene through the production control (the settings' scene picker).
			gwta: "apply graph scene {name: string}",
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				await this.openSettings(page, "scenes");
				const ok = await page.evaluate(
					({ sceneName, pickerId }) => {
						const picker = document.querySelector("shu-polymorphic-graph-view")?.querySelector(`[data-testid='${pickerId}']`) as HTMLSelectElement | null;
						if (!picker || ![...picker.options].some((option) => option.value === sceneName)) return false;
						picker.value = sceneName;
						picker.dispatchEvent(new Event("change", { bubbles: true }));
						return true;
					},
					{ sceneName: name, pickerId: POLYMORPHIC_IDS.SCENE_PICKER },
				);
				if (!ok) return actionNotOK(`no scene saved as "${name}" is offered on the view`);
				// Reading the scene back is a round trip; the view says which scene it is showing once the return has landed.
				await page.waitForFunction((sceneName) => document.querySelector("shu-polymorphic-graph-view")?.getAttribute("data-scene") === sceneName, name, { timeout: 10000 });
				await this.settle(page);
				return actionOK();
			},
		},
		graphOffersScene: {
			// The scene is offered without reloading the page: a scene saved anywhere reaches this view as live data.
			gwta: "graph offers scene {name: string}",
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				await this.openSettings(page, "scenes");
				await page.waitForFunction(
					({ pickerId, sceneName }) => {
						const picker = document.querySelector("shu-polymorphic-graph-view")?.querySelector(`[data-testid='${pickerId}']`) as HTMLSelectElement | null;
						return !!picker && [...picker.options].some((option) => option.value === sceneName);
					},
					{ pickerId: POLYMORPHIC_IDS.SCENE_PICKER, sceneName: name },
					{ timeout: 15000 },
				);
				return actionOK();
			},
		},
		graphSceneMatches: {
			// What the view shows now, compared option by option with what it showed when the scene was saved. The
			// comparison is against the view's OWN record (captureScene), and the values under comparison travelled through
			// the store and back, so this proves the return restored every option rather than that a control changed.
			gwta: "graph scene matches {name: string}",
			action: async ({ name }: { name: string }) => {
				const saved = this.savedScenes.get(name);
				if (!saved) return actionNotOK(`no scene was saved as "${name}" in this run`);
				const live = await this.captureGraphScene(await this.page());
				const differing = Object.entries(saved).flatMap(([tag, fields]) =>
					Object.entries(fields)
						.filter(([field, value]) => JSON.stringify(live[tag]?.[field]) !== JSON.stringify(value))
						.map(([field, value]) => `${tag}.${field}: saved ${JSON.stringify(value)}, showing ${JSON.stringify(live[tag]?.[field])}`),
				);
				return differing.length > 0 ? actionNotOK(`the graph does not match scene "${name}": ${differing.join("; ")}`) : actionOK();
			},
		},
		showGraphOntology: {
			// Reveal the merged ONTOLOGY (schema) ALONGSIDE the live data by ticking the default-hidden Class + Property filter chips (revealSchema); the scenario waitForGraphNode steps confirm the terms appear.
			gwta: "show the graph ontology",
			action: async () => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				await page.evaluate(() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { revealSchema(v: boolean): void }).revealSchema(true));
				await page.waitForTimeout(400);
				await this.settle(page);
				await this.waitForStableCount(page);
				return actionOK();
			},
		},
		returnToLiveData: {
			gwta: "return the graph to live data",
			action: async () => {
				const page = await this.page();
				await page.evaluate(() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { revealSchema(v: boolean): void }).revealSchema(false));
				await page.waitForTimeout(400);
				await this.settle(page);
				await this.waitForStableCount(page);
				return actionOK();
			},
		},
		graphHasRoleContainer: {
			// Assert a role container with the given TITLE exists: the trust-triangle container is named by its party
			// (Issuer's name, Holder's name, the verifier's name, "Verifiable Data Registry"), never a cryptic id/DID.
			gwta: "graph shows a {name} container",
			action: async ({ name }: { name: string }) => {
				const titles = await (await this.page()).evaluate(() =>
					(document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { enclosures: Array<{ title: string }> } }).inspect().enclosures.map((e) => e.title),
				);
				return titles.includes(name) ? actionOK() : actionNotOK(`no "${name}" container, containers present: [${titles.join(", ")}]`);
			},
		},
		timeCursorHidesFuture: {
			// Scrub the shared time cursor to a cutoff in the middle of the nodes' ages: nodes recorded after it vanish;
			// clearing the cursor (null = live) restores them. The graph reacts to the same global cursor the timeline drives.
			gwta: "scrubbing the time cursor hides newer nodes and restores on clear",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				const count = () => page.evaluate(() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { nodes: number } }).inspect().nodes);
				const before = await count();
				const times = (await this.fullInspect(page)).sample
					.map((s) => s.t)
					.filter((t): t is number => t != null)
					.sort((a, b) => a - b);
				if (times.length < 3) return actionNotOK(`not enough timed nodes to scrub (${times.length})`);
				const cutoff = times[Math.floor(times.length / 2)]; // median age, hides the newer half
				// The time-filter repaint is debounced, so poll for the expected transition rather than a fixed delay.
				const waitUntil = async (pred: (n: number) => boolean): Promise<void> => {
					for (let i = 0; i < 20 && !pred(await count()); i++) await page.waitForTimeout(150);
				};
				await this.call(page, "setTimeCursor", [cutoff]);
				await waitUntil((n) => n < before);
				const hidden = await count();
				await this.call(page, "setTimeCursor", [null]);
				await waitUntil((n) => n >= before);
				const restored = await count();
				if (hidden >= before) return actionNotOK(`scrubbing the cursor did not hide newer nodes (${before} shown → ${hidden})`);
				if (restored < before) return actionNotOK(`clearing the cursor did not restore nodes (${before} → ${restored})`);
				return actionOK();
			},
		},
		graphShowsGroupBoxes: {
			gwta: "graph shows a box around each group",
			action: async () => {
				const i = await (await this.page()).evaluate(() => {
					const ins = (
						document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { enclosures: unknown[]; grouped: boolean; sample: Array<{ type: string }> } }
					).inspect();
					return { boxes: ins.enclosures.length, grouped: ins.grouped, types: [...new Set(ins.sample.map((s) => s.type))] };
				});
				return i.boxes > 0 ? actionOK() : actionNotOK(`grouped mode drew no enclosure boxes (grouped=${i.grouped}, types=[${i.types.join(", ")}])`);
			},
		},
		graphReadsAsLayeredFlow: {
			// The td/lr layered ground truth: bucket nodes by their pinned target rank (the flow-axis target) and assert the
			// flow reads cleanly, successive ranks ADVANCE along the flow axis (td: down y, lr: along x), their bands are
			// DISJOINT (no rank overlaps the next), and the rank axis is not DWARFED by the recorded-time depth (else each
			// rank smears front-to-back into a 3D cloud rather than reading as a hierarchy).
			gwta: "graph reads as a clear layered flow",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				const L = await page.evaluate(
					() =>
						(
							document.querySelector("shu-polymorphic-graph-view") as unknown as {
								inspect(): { layered: { direction: string; flowAxis: "x" | "y"; nodes: Array<{ id: string; tx: number; ty: number; x: number; y: number; z: number }> } | null };
							}
						).inspect().layered,
				);
				if (!L) return actionNotOK("the view is not a layered (td/lr) view");
				const flowT = (n: { tx: number; ty: number }): number => (L.flowAxis === "y" ? n.ty : n.tx);
				const flowR = (n: { x: number; y: number }): number => (L.flowAxis === "y" ? n.y : n.x);
				const layers = new Map<number, number[]>();
				for (const n of L.nodes) {
					const k = Math.round(flowT(n));
					const b = layers.get(k);
					if (b) b.push(flowR(n));
					else layers.set(k, [flowR(n)]);
				}
				const bands = [...layers.entries()]
					.sort((a, b) => a[0] - b[0])
					.map(([k, vs]) => ({ k, mean: vs.reduce((s, v) => s + v, 0) / vs.length, min: Math.min(...vs), max: Math.max(...vs) }));
				if (bands.length < 2) return actionNotOK(`only ${bands.length} rank(s): the DAG did not stratify into a flow (nodes=${L.nodes.length})`);
				for (let j = 1; j < bands.length; j++) {
					if (bands[j].mean <= bands[j - 1].mean) return actionNotOK(`ranks not ordered along ${L.flowAxis}: means [${bands.map((b) => b.mean.toFixed(0)).join(", ")}]`);
					if (bands[j].min <= bands[j - 1].max)
						return actionNotOK(
							`ranks ${j - 1},${j} overlap on ${L.flowAxis}: the flow is blurred, not banded: [..${bands[j - 1].max.toFixed(0)}] vs [${bands[j].min.toFixed(0)}..]`,
						);
				}
				const span = (sel: (n: { x: number; y: number; z: number }) => number): number => {
					const vs = L.nodes.map(sel);
					return Math.max(...vs) - Math.min(...vs);
				};
				const flowExt = span(flowR);
				const zExt = span((n) => n.z);
				if (flowExt < zExt)
					return actionNotOK(
						`the rank axis spans only ${flowExt.toFixed(0)} but the time-depth spans ${zExt.toFixed(0)}: the hierarchy is dwarfed by depth and won't read as a flow`,
					);
				return actionOK();
			},
		},
		containersDoNotOverlap: {
			// The group enclosure boxes must tile the plane without colliding, overlapping boxes are the "containers overlap
			// badly" failure. Assert every pair of boxes is disjoint in the x/y plane (AABB), reporting the worst pair.
			gwta: "group containers do not overlap",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				const boxes = await page.evaluate(
					() =>
						(
							document.querySelector("shu-polymorphic-graph-view") as unknown as {
								inspect(): { enclosures: Array<{ title: string; x: number; y: number; sx: number; sy: number }> };
							}
						).inspect().enclosures,
				);
				if (boxes.length < 2) return actionNotOK(`only ${boxes.length} container(s), need at least 2 to check overlap`);
				const overlap1D = (c1: number, s1: number, c2: number, s2: number): number => Math.max(0, Math.min(c1 + s1 / 2, c2 + s2 / 2) - Math.max(c1 - s1 / 2, c2 - s2 / 2));
				for (let i = 0; i < boxes.length; i++)
					for (let j = i + 1; j < boxes.length; j++) {
						const a = boxes[i];
						const b = boxes[j];
						const ox = overlap1D(a.x, a.sx, b.x, b.sx);
						const oy = overlap1D(a.y, a.sy, b.y, b.sy);
						if (ox > 0 && oy > 0) return actionNotOK(`containers "${a.title}" and "${b.title}" overlap by ${ox.toFixed(0)}×${oy.toFixed(0)} in x/y`);
					}
				return actionOK();
			},
		},
		graphContainersCompact: {
			// The enclosure boxes must pack TIGHT, not scatter across a huge canvas (the unusable spread): assert the union
			// bounding box of all containers is within K× their summed box areas: the live mirror of the shelfPack unit
			// ceiling. The old isotropic-disc layout flung containers across the viewport and would blow this ceiling open.
			gwta: "group containers pack compactly",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				const boxes = await page.evaluate(
					() =>
						(document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { enclosures: Array<{ x: number; y: number; sx: number; sy: number }> } }).inspect()
							.enclosures,
				);
				if (boxes.length < 2) return actionNotOK(`only ${boxes.length} container(s), need at least 2 to check compactness`);
				const bboxArea =
					(Math.max(...boxes.map((b) => b.x + b.sx / 2)) - Math.min(...boxes.map((b) => b.x - b.sx / 2))) *
					(Math.max(...boxes.map((b) => b.y + b.sy / 2)) - Math.min(...boxes.map((b) => b.y - b.sy / 2)));
				const sumArea = boxes.reduce((s, b) => s + b.sx * b.sy, 0);
				const K = 8; // looser than the unit K=4: the live boxes carry pad + the cohesion spreads members within a cell
				if (bboxArea > K * sumArea) return actionNotOK(`containers scattered: bounding-box area ${bboxArea.toFixed(0)} > ${K}× their summed area ${sumArea.toFixed(0)}`);
				return actionOK();
			},
		},
		saveGraphStill: {
			// The graph as a self-contained SVG, saved as an artifact the way a screenshot is: it rides the artifact
			// stream into the run's report, and stands alone as an image. The markup comes from the view's still():
			// the SAME placed nodes the WebGL renderer displays, drawn by the SVG renderer, so a still in a report
			// always matches what the run's reader saw.
			gwta: "save a graph still",
			productsSchema: z.object({ path: z.string(), nodes: z.number() }),
			action: async (_: unknown, featureStep: TFeatureStep) => {
				const page = await this.page();
				await this.settle(page);
				const { svg, sceneNodes } = await page.evaluate(() => {
					const view = document.querySelector("shu-polymorphic-graph-view") as unknown as { still(): string; nodeMap?: Map<string, unknown> };
					return { svg: view?.still() ?? "", sceneNodes: view?.nodeMap?.size ?? 0 };
				});
				if (!svg.startsWith("<svg")) return actionNotOK("the view produced no still, is the graph view mounted?");
				const nodes = (svg.match(/<circle /g) ?? []).length;
				if (nodes !== sceneNodes) return actionNotOK(`the still drew ${nodes} node(s) but the scene holds ${sceneNodes}: a still must show exactly what is on screen`);
				const wp = this.webPlaywright();
				if (!wp.storage) return actionNotOK("save a graph still: no storage stepper in the world");
				const saved = await saveImageArtifact(this.getWorld(), wp.storage, featureStep, `graph-still-${featureStep.seqPath.join(".")}.svg`, svg, "image/svg+xml");
				return actionOKWithProducts({ path: saved.baseRelativePath, nodes });
			},
		},
		toggleGraphReading: {
			// The head's reading toggle: it holds the accessible document open for everyone, not only for a keyboard
			// reader who tabs into it.
			gwta: "toggle graph reading",
			action: async () => {
				const page = await this.page();
				await page.locator(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.READ}"]`).click();
				return actionOK();
			},
		},
		graphReadingShown: {
			// Shown means SHOWN, not merely present: the region is clipped to a pixel until it is opened, so this reads
			// its rendered size rather than its markup. It reads the painted background too: the guide lies over the
			// graph, so it is translucent, which no jsdom test can tell from opaque.
			gwta: "graph reading is on screen",
			action: async () => {
				const page = await this.page();
				const seen = await page.evaluate((a11y) => {
					const region = document.querySelector(`[data-testid="${a11y}"]`) as HTMLElement | null;
					const r = region?.getBoundingClientRect();
					if (!r) return null;
					const style = getComputedStyle(region as HTMLElement);
					const list = region?.querySelector("ol");
					const listStyle = list ? getComputedStyle(list) : null;
					return {
						w: r.width,
						h: r.height,
						background: style.backgroundColor,
						fontSize: Number.parseFloat(style.fontSize),
						markerRoom: listStyle ? Number.parseFloat(listStyle.paddingLeft) : 0,
					};
				}, SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y);
				if (!seen) return actionNotOK("no accessible graph document region in the scene");
				if (!(seen.w > 20 && seen.h > 20)) return actionNotOK(`the reading is clipped away (${seen.w.toFixed(0)}×${seen.h.toFixed(0)})`);
				const alpha = paintedAlpha(seen.background);
				if (alpha >= 1) return actionNotOK(`the reading is painted opaque (${seen.background}), so the graph under it is hidden`);
				// A line's number is drawn in the list's left padding: too little, and it runs back over the region's own
				// edge. Two characters' worth is what a numbered reading of any length needs.
				return seen.markerRoom >= seen.fontSize * 2
					? actionOK()
					: actionNotOK(`a line's number has ${seen.markerRoom}px to sit in, which its own edge takes back at ${seen.fontSize}px text`);
			},
		},
		graphA11yDocument: {
			// The accessible document is a medium beside WebGL: it must list exactly the drawn nodes and carry a live
			// status line, so a reader without the picture reads the same graph. The composite renderer feeds both from
			// one draw; this proves they agree in the live app.
			gwta: "accessible graph document lists every drawn node",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				const res = await page.evaluate((a11y) => {
					const view = document.querySelector("shu-polymorphic-graph-view") as unknown as ({ inspect(): { nodes: number } } & Element) | null;
					const root = view?.shadowRoot ?? view;
					const region = root?.querySelector(`[data-testid="${a11y}"]`) ?? null;
					const entryIds = [...(region?.querySelectorAll("ol > li > [data-node-id]") ?? [])].map((b) => b.getAttribute("data-node-id"));
					// An edge line's target is a way to that node, so every one of them must name a node that was drawn:
					// a reading that offers a way to something not there leads a reader who cannot see the picture nowhere.
					const wayIds = [...(region?.querySelectorAll("ol > li ul [data-node-id]") ?? [])].map((b) => b.getAttribute("data-node-id"));
					const drawn = new Set(entryIds);
					return {
						nodes: view?.inspect().nodes ?? -1,
						entries: region ? entryIds.length : -1,
						waysNowhere: wayIds.filter((id) => !drawn.has(id)).length,
						status: region?.querySelector('[role="status"]')?.textContent ?? "",
					};
				}, SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y);
				if (res.entries < 0) return actionNotOK("no accessible graph document region in the scene");
				if (res.entries !== res.nodes) return actionNotOK(`the accessible document lists ${res.entries} entries for ${res.nodes} drawn nodes`);
				if (res.waysNowhere > 0) return actionNotOK(`${res.waysNowhere} of the document's edge lines offer a way to a node it does not list`);
				if (!res.status.includes(`${res.nodes} nodes`)) return actionNotOK(`the status line does not announce the node count: "${res.status}"`);
				return actionOK();
			},
		},
		graphSpreads: {
			gwta: "graph nodes spread on both axes",
			action: async () => {
				// Judge the RESTING layout: sampling mid-warmup reads positions the engine has not assigned yet
				// (undefined → a NaN range), which is a race, not a verdict on the layout.
				const page = await this.page();
				await this.settle(page);
				const s = (await this.fullInspect(page)).sample;
				const rangeX = range(s.map((n) => n.x));
				const rangeY = range(s.map((n) => n.y));
				return rangeX > 10 && rangeY > 10 ? actionOK() : actionNotOK(`graph is not spread on both axes (x range ${rangeX.toFixed(1)}, y range ${rangeY.toFixed(1)})`);
			},
		},
		graphDepthEncodesTime: {
			gwta: "graph depth encodes time",
			action: async () => {
				// z is the time axis: older nodes sit at a different depth, so across a time-spread fixture z must vary.
				const s = (await this.fullInspect(await this.page())).sample.filter((n) => n.t != null);
				if (s.length < 2) return actionNotOK("not enough timed nodes to judge the depth axis");
				return range(s.map((n) => n.z)) > 1 ? actionOK() : actionNotOK(`node depth (z) does not vary with time (z range ${range(s.map((n) => n.z)).toFixed(2)})`);
			},
		},
		placeGraphDepthBy: {
			// Switch what the depth (z) axis encodes via the production select (the view-settings z basis), then wait for
			// the relayout. One step for every basis so a feature can flip time ↔ connections and prove the depth re-places.
			gwta: `place graph depth by {basis: ${DOMAIN_GRAPH_ZBASIS}}`,
			action: async ({ basis }: { basis: string }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				await this.openSettings(page, "layout");
				const ok = await page.evaluate(
					({ value, zBasisId }) => {
						const sel = document.querySelector(`shu-polymorphic-graph-view [data-testid='${zBasisId}']`) as HTMLSelectElement | null;
						if (!sel) return false;
						sel.value = value;
						sel.dispatchEvent(new Event("change", { bubbles: true }));
						return true;
					},
					{ value: ZBASIS_VALUE[basis], zBasisId: POLYMORPHIC_IDS.Z_BASIS },
				);
				if (!ok) return actionNotOK("no z-basis select on the graph");
				await this.settle(page); // the change schedules the relayout synchronously; settle waits for it to run and come to rest
				return actionOK();
			},
		},
		graphChipsShowDepth: {
			// Turning "label as depth" on re-labels every chip with the value that places its depth, and turning it off
			// puts the names back: each taking effect on its own, with no other change to force a redraw. Reads what the
			// chips say and compares the three states, so it needs no knowledge of this fixture's names.
			gwta: "graph chips re-label by depth and back",
			action: async () => {
				const page = await this.page();
				await this.openSettings(page, "layout");
				const chips = async (): Promise<Record<string, string | null>> => {
					await this.settle(page);
					return page.evaluate(() =>
						Object.fromEntries(
							(document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { sample: Array<{ id: string; chip: string | null }> } })
								.inspect()
								.sample.map((n) => [n.id, n.chip]),
						),
					);
				};
				const setLabelAsDepth = (on: boolean): Promise<boolean> =>
					page.evaluate(
						({ id, on }) => {
							const box = document.querySelector(`shu-polymorphic-graph-view [data-testid='${id}']`) as HTMLInputElement | null;
							if (!box) return false;
							if (box.checked !== on) box.click();
							return true;
						},
						{ id: POLYMORPHIC_IDS.LABEL_AS_Z as string, on },
					);
				if (!(await setLabelAsDepth(false))) return actionNotOK("no label-as-depth control in the open depth settings");
				const named = await chips();
				if (Object.keys(named).length === 0) return actionNotOK("no chips drawn to re-label");
				await setLabelAsDepth(true);
				const byDepth = await chips();
				const changed = Object.keys(named).filter((id) => byDepth[id] !== named[id]);
				if (changed.length === 0) return actionNotOK(`turning label-as-depth on changed no chip (still "${Object.values(named)[0]}"): it took another change to redraw`);
				await setLabelAsDepth(false);
				const back = await chips();
				const stuck = Object.keys(named).filter((id) => back[id] !== named[id]);
				if (stuck.length > 0) return actionNotOK(`${stuck.length} chip(s) did not go back to their name (e.g. "${back[stuck[0]]}" for "${named[stuck[0]]}")`);
				return actionOK();
			},
		},
		graphDepthEncodesConnections: {
			gwta: "graph depth encodes connections",
			action: async () => {
				// Under the connections basis, a node's depth is its degree: a MORE-connected node sits toward the front
				// (smaller z), a less-connected one recedes. Across a fixture with varied degree the front/back order must hold.
				const s = (await this.fullInspect(await this.page())).sample.filter((n) => n.degree != null);
				if (s.length < 2) return actionNotOK("not enough nodes with a degree to judge the depth axis");
				const byDegree = [...s].sort((a, b) => (a.degree ?? 0) - (b.degree ?? 0));
				const low = byDegree[0];
				const high = byDegree[byDegree.length - 1];
				if ((high.degree ?? 0) === (low.degree ?? 0)) return actionNotOK("every node has the same degree: the fixture can't exercise connection depth");
				return (high.z ?? 0) < (low.z ?? 0)
					? actionOK()
					: actionNotOK(`more connections should sit shallower: degree ${high.degree} at z=${(high.z ?? 0).toFixed(1)} vs degree ${low.degree} at z=${(low.z ?? 0).toFixed(1)}`);
			},
		},
		graphDimsExceptFocused: {
			// After a focus (hover/open), the focused neighbourhood stays full-opacity and everything else dims.
			gwta: "graph dims all but the focused node",
			action: async () => {
				const i = await this.fullInspect(await this.page());
				if (!i.focus.hover && !i.focus.selected) return actionNotOK("nothing is focused");
				const dim = i.sample.filter((n) => (n.opacity ?? 1) < 0.5).length;
				const lit = i.sample.filter((n) => (n.opacity ?? 1) > 0.9).length;
				return dim > 0 && lit > 0 && lit < i.sample.length ? actionOK() : actionNotOK(`focus did not dim the rest (lit ${lit}, dim ${dim}, of ${i.sample.length})`);
			},
		},
		focusedEdgesBright: {
			gwta: "focused edges are brighter than the rest",
			action: async () => {
				const e = (await this.fullInspect(await this.page())).edges.filter((x) => x.lineOpacity != null);
				if (e.length < 2) return actionNotOK("not enough edges to compare");
				const bright = e.filter((x) => (x.lineOpacity ?? 0) > 0.9).length;
				const dim = e.filter((x) => (x.lineOpacity ?? 0) < 0.5).length;
				return bright > 0 && dim > 0 ? actionOK() : actionNotOK(`edges not split into bright/dim under focus (bright ${bright}, dim ${dim}, of ${e.length})`);
			},
		},
		graphNodePinned: {
			// A node the user dragged holds the place they dropped it in, through a live data repaint: a streamed arrival
			// must neither unpin it nor put it back where the layout would have had it.
			gwta: "graph node {match} stays pinned",
			action: async ({ match }: { match: string }) => {
				const page = await this.page();
				const id = this.opened.get(match) ?? (await this.waitForNodePresent(page, match)); // "dragged" resolves to the node the drag step remembered
				if (!id) return actionNotOK(`graph node "${match}" not present`);
				const now = (await this.fullInspect(page)).sample.find((s) => s.id === id);
				if (now?.fx == null) return actionNotOK(`graph node "${id}" is no longer pinned (fx=${now?.fx ?? null}): the repaint unpinned it`);
				const dropped = this.droppedAt.get(match);
				if (!dropped) return actionOK(); // pinned by a reload rather than by this run's drag: the place is the reloaded one
				const moved = Math.hypot(now.x - dropped.x, now.y - dropped.y);
				return moved <= 1
					? actionOK()
					: actionNotOK(
							`graph node "${id}" moved ${moved.toFixed(1)} from where it was dropped (${dropped.x.toFixed(1)}, ${dropped.y.toFixed(1)}) to (${now.x.toFixed(1)}, ${now.y.toFixed(1)})`,
						);
			},
		},
		graphHoldsDistanceSince: {
			// Following moves what the camera LOOKS AT, never how close it is. The apparent size of what it looks at, so
			// whether that node's label is readable, is set by the camera's distance to its target, which must therefore
			// be the same after following to another node as before. (inspect's worldPerPx is measured at the ORIGIN, so
			// it moves whenever the target moves in depth even though nothing zoomed; the distance is the reliable signal.)
			gwta: "graph holds its distance to what it looks at since {name}",
			action: async ({ name }: { name: string }) => {
				const before = this.snapshots.get(name);
				const after = await this.snapshot(await this.page());
				const span = (s?: Snapshot): number | null =>
					s?.camera?.target ? Math.hypot(s.camera.x - s.camera.target.x, s.camera.y - s.camera.target.y, s.camera.z - s.camera.target.z) : null;
				const was = span(before);
				const now = span(after);
				if (was === null || now === null) return actionNotOK(`no camera aim to compare (remembered "${name}"=${was}, live=${now})`);
				const drift = Math.abs(now - was) / was;
				return drift <= 0.01
					? actionOK()
					: actionNotOK(`the camera's distance to what it looks at moved ${(drift * 100).toFixed(1)}% since "${name}": a label readable then is not readable now`);
			},
		},
		graphFollowIsOff: {
			// Follow's off state read where a person reads it: the head toggle's own pressed state.
			gwta: "graph follow is off",
			action: async () => {
				const page = await this.page();
				const pressed = await page.locator(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.FOLLOW}"]`).getAttribute("aria-pressed");
				return pressed === "false" ? actionOK() : actionNotOK(`the follow toggle still reads aria-pressed=${pressed}`);
			},
		},
		graphHasNoActiveNode: {
			// A selection naming a node this graph does not show (filtered out by type, dropped by prune, never fetched)
			// leaves NO active node: nothing glows, and nothing is focused, so the graph doesn't dim itself against a
			// focus that isn't on screen.
			gwta: "graph has no active node",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				const state = await page.evaluate(() => {
					const view = document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { focus: { selected: string | null }; highlighted: number } };
					const i = view.inspect();
					return { selected: i.focus.selected, highlighted: i.highlighted };
				});
				if (state.selected !== null) return actionNotOK(`the graph still calls "${state.selected}" active though it is not shown`);
				return state.highlighted === 0 ? actionOK() : actionNotOK(`${state.highlighted} node(s) still glow with no active node`);
			},
		},
		graphHighlightsActive: {
			// EXACTLY the active node wears the highlight: the one whose column is open, so what is being read is visible
			// in the graph. Reads the scene's own inspect() highlighted count: a count above one means the highlight is
			// marking something other than the active node.
			gwta: "graph highlights the active node, and only it",
			action: async () => {
				const page = await this.page();
				const count = async (): Promise<number> =>
					page.evaluate(() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { highlighted: number } }).inspect().highlighted);
				// The glow is added on the render after the selection lands, so poll rather than read once.
				try {
					await page.waitForFunction(
						() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { highlighted: number } }).inspect().highlighted === 1,
						undefined,
						{ timeout: 5000 },
					);
				} catch {
					return actionNotOK(`${await count()} node(s) wear the active highlight, exactly the active node must`);
				}
				return actionOK();
			},
		},
		graphNodePlaced: {
			// A streamed-in node lands in the layout (not collapsed at the origin), proves a live arrival is laid out, not dropped.
			gwta: "graph node {match} is placed in the layout",
			action: async ({ match }: { match: string }) => {
				const page = await this.page();
				const id = await this.waitForNodePresent(page, match);
				if (!id) return actionNotOK(`graph node "${match}" not present`);
				const n = (await this.fullInspect(page)).sample.find((s) => s.id === id);
				if (!n) return actionNotOK(`graph node "${id}" not in the layout sample`);
				return Math.hypot(n.x, n.y) > 1 ? actionOK() : actionNotOK(`graph node "${id}" sits at the origin: the streamed node was not laid out`);
			},
		},
		previewGraphType: {
			// Hovering a type in the filter legend previews it: that type stays full and every other type dims, even over a node focus.
			gwta: "preview graph type {type}",
			action: async ({ type }: { type: string }) => {
				await this.dispatchPreview(await this.page(), type);
				return actionOK();
			},
		},
		clearGraphTypePreview: {
			gwta: "clear the graph type preview",
			action: async () => {
				await this.dispatchPreview(await this.page(), null);
				return actionOK();
			},
		},
		graphShowsOnlyTypeFull: {
			// The previewed type is full-opacity and every other type is dim: the preview overriding any focus dimming.
			gwta: "only graph type {type} is shown full",
			action: async ({ type }: { type: string }) => {
				const s = (await this.fullInspect(await this.page())).sample;
				const dimOfType = s.filter((n) => n.type === type && (n.opacity ?? 1) < 0.9).length;
				const litOffType = s.filter((n) => n.type !== type && (n.opacity ?? 1) > 0.9).length;
				if (dimOfType) return actionNotOK(`${dimOfType} ${type} node(s) are dim: the preview did not light its own type`);
				if (litOffType) return actionNotOK(`${litOffType} non-${type} node(s) are still full: the preview did not dim the rest`);
				return actionOK();
			},
		},
		ctrlDragNode: {
			// Ctrl is the camera modifier: a ctrl-press on a node orbits the camera instead of grabbing the node (OrbitControls'
			// modified press rotates; the node-drag handler bows out on ctrl). The node must hold still; the camera azimuth must turn.
			// Deterministic like the drag step: it aims at whichever node the view reports draggable, not a fixed occludable id.
			gwta: "ctrl-dragging a node orbits the camera instead of moving it",
			action: async () => {
				const page = await this.page();
				const { target, diag } = await this.pressFirstDraggable(page);
				if (!target) return actionNotOK(`no draggable node to aim at, ${diag}`);
				await page.mouse.up(); // release the plain press; re-press with ctrl held
				const before = await this.fullInspect(page);
				await page.keyboard.down("Control");
				await page.mouse.move(target.x, target.y, { steps: 2 });
				await page.mouse.down();
				const pending = (await this.fullInspect(page)).dragPending;
				await page.mouse.move(target.x + 140, target.y + 20, { steps: 10 }); // a camera-orbit drag
				await page.mouse.up();
				await page.keyboard.up("Control");
				await page.waitForTimeout(150);
				const after = await this.fullInspect(page);
				if (pending !== null) return actionNotOK(`ctrl-press started a node drag (dragPending=${pending}), ctrl must orbit, not grab`);
				const moved = dist(before.sample, after.sample, target.id);
				if (moved > 2) return actionNotOK(`node "${target.id}" moved ${moved.toFixed(1)} under a ctrl-drag: it should orbit the camera, not the node`);
				const turned = before.azimuth != null && after.azimuth != null ? Math.abs(after.azimuth - before.azimuth) : 0;
				return turned > 0.01 ? actionOK() : actionNotOK(`the camera did not orbit under a ctrl-drag (azimuthΔ=${turned.toFixed(3)})`);
			},
		},
		magnifyNoWiden: {
			// A focused chip pops to ~6× on screen, but the press-pick must read its RESTING footprint, else a magnified node
			// captures every orbit press around it. Probe pickAt() at fixed offsets with the node at rest vs magnified: the
			// hittable offsets must not grow. pickAt() has no pointer side effects, so the magnify stays put while the probe runs.
			gwta: "magnifying the {name} node does not widen where it can be grabbed",
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				const id = this.opened.get(name) ?? (await this.resolveNodeId(page, name));
				if (!id) return actionNotOK(`no graph node "${name}"`);
				// The head-on aim, not fit: fit keeps whatever orbit earlier scenarios left, and an oblique aim can put
				// another chip in front of the probed one along the ray. The span probe needs the deterministic frame.
				await this.call(page, "rotateTo", ["xy"]);
				await this.call(page, "setHoveredNode", [null]);
				await this.settle(page);
				// Measure the grab SPAN, the farthest offset from the anchor that still picks the node, at rest vs magnified.
				// A correct base-scale pick leaves the span ~unchanged (a focus re-anchor may shift it a few px); a halo that
				// hijacks presses widens it toward the 6× magnify. Span, not exact offsets, so a small anchor shift is allowed.
				const offsets = [0, 10, 20, 30, 45, 65, 90, 120];
				const spanOf = async (): Promise<number> => {
					let max = -1;
					for (const dx of offsets) {
						const p = await this.projectNode(page, id, dx);
						if ((await this.pickAt(page, p.x, p.y)) === id) max = dx;
					}
					return max;
				};
				const base = await spanOf();
				await this.call(page, "openNode", [id]); // select it → it becomes the focus and magnifies (a hover is ignored while another node is selected)
				await page.waitForFunction(
					(nid) =>
						((document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { sample: Array<{ id: string; k: number }> } })
							.inspect()
							.sample.find((s) => s.id === nid)?.k ?? 1) > 1,
					id,
					{ timeout: 4000 },
				);
				const magnified = await spanOf();
				if (base < 0) return actionNotOK(`node "${id}" was not pickable at any probed offset at rest`);
				const SHIFT_TOLERANCE_PX = 25; // a focus re-anchor may move the footprint a little; a hijack moves it a lot
				return magnified <= base + SHIFT_TOLERANCE_PX
					? actionOK()
					: actionNotOK(`magnifying widened the grab span to ${magnified}px (rest ${base}px): the magnified halo is hijacking presses meant to orbit`);
			},
		},
		profileGraphRender: {
			// Set the per-type limit through the production slider (both directions), let the refetch + layout settle, and
			// read the render-stage split the view accumulated (inspect().profile): compute (toGraphData), force warmup (the
			// graphData set), and label textures (per-node canvas raster + GPU upload). Reports whatever scale the connected
			// store holds. A limit that does not change the visible set re-renders nothing (0 repaints), profile a limit
			// below the node count to force truncation, then above it to force expansion.
			gwta: "profile graph render at {perTypeLimit} nodes per type",
			action: async ({ perTypeLimit }: { perTypeLimit: string }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				const limit = Number(perTypeLimit);
				const driven = await page.evaluate((n) => {
					const view = document.querySelector("shu-polymorphic-graph-view") as unknown as { resetProfile(): void } | null;
					const slider = document.querySelector("shu-polymorphic-graph-view shu-graph-filter")?.shadowRoot?.querySelector('input[type="range"]') as HTMLInputElement | null;
					if (!view || !slider) return false;
					view.resetProfile(); // measure only the re-render this limit change triggers
					slider.value = String(n); // drive the real slider: input tracks the label, change (release) dispatches the refetch
					slider.dispatchEvent(new Event("input", { bubbles: true }));
					slider.dispatchEvent(new Event("change", { bubbles: true }));
					return true;
				}, limit);
				if (!driven) return actionNotOK("no graph view / filter slider to profile");
				await page.waitForTimeout(400); // the scoped refetch + repaint debounce
				await this.settle(page);
				await this.waitForStableCount(page);
				const p = await page.evaluate(
					() =>
						(
							document.querySelector("shu-polymorphic-graph-view") as unknown as {
								inspect(): { profile: { nodes: number; repaints: number; computeMs: number; setMs: number; labelsMs: number } };
							}
						).inspect().profile,
				);
				const forceMs = Math.max(0, p.setMs - p.labelsMs);
				this.getWorld().eventLogger.info(
					`polymorphic render profile @ perTypeLimit ${limit}: ${p.nodes} nodes over ${p.repaints} repaint(s), compute ${p.computeMs.toFixed(1)}ms, force-warmup ${forceMs.toFixed(1)}ms, label-textures ${p.labelsMs.toFixed(1)}ms (graphData set ${p.setMs.toFixed(1)}ms)`,
					{ "haibun.polymorphic.profile": JSON.stringify({ ...p, forceMs }) },
				);
				return p.repaints > 0 ? actionOK() : actionNotOK(`limit ${limit} re-rendered nothing (0 repaints): it did not change the visible set, so there is nothing to profile`);
			},
		},
	};

	/** The full live inspect() (sample with type/opacity/k/z/t, edges, focus, azimuth, dragPending): the render state the behaviour asserts read. */
	private fullInspect(page: Page): Promise<FullInspect> {
		return page.evaluate(() => {
			const i = (window as unknown as { shuPolymorphic: { inspect(): FullInspect & { azimuth: number | null; dragPending: string | null } } }).shuPolymorphic.inspect();
			return { sample: i.sample, edges: i.edges, focus: i.focus, azimuth: i.azimuth, dragPending: i.dragPending };
		});
	}

	/** Find a pixel that picks node `id` AND that a real pointer reaches, then press there (pointer left DOWN; the caller
	 * drags then ups). Probes with the side-effect-free pickAt: a real press on a MISS would orbit the camera and walk the
	 * node off-screen, defeating the next probe. The chip sits right of and a little below its anchor, and an overlay (the
	 * actions bar) can cover part of it, so accept only a pixel the view picks AND whose elementFromPoint is inside the view.
	 * Returns null (pointer up) if nothing hit. The single press path drag + ctrl + magnify tests share. */
	private async pressOnNode(page: Page, id: string): Promise<{ x: number; y: number } | null> {
		for (const dy of [0, 8, -8, 16, -16]) {
			for (const dx of [12, 6, 0, 24, 36, -8, -20]) {
				const c = await this.projectNode(page, id, dx);
				const p = { x: c.x, y: c.y + dy };
				if ((await this.pickAt(page, p.x, p.y)) !== id) continue;
				const reachable = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("shu-polymorphic-graph-view") != null, p);
				if (!reachable) continue;
				await page.mouse.move(p.x, p.y, { steps: 2 });
				await page.mouse.down();
				return p;
			}
		}
		return null;
	}

	/** Wait for a node's PROJECTED screen position to stop moving. A fit/reframe animates over several frames AFTER the
	 * engine freezes, so settle() alone leaves the node mid-flight; poll its projection until two reads agree to ~1px. */
	private async settleNodeProjection(page: Page, id: string): Promise<void> {
		let prev: { x: number; y: number } | null = null;
		for (let i = 0; i < 40; i++) {
			let p: { x: number; y: number } | null = null;
			try {
				p = await this.projectNode(page, id, 0);
			} catch {
				p = null;
			}
			if (p && prev && Math.abs(p.x - prev.x) < 1 && Math.abs(p.y - prev.y) < 1) return;
			prev = p;
			await page.waitForTimeout(40);
		}
	}

	/** Frame the graph, then press the first node the view reports DRAGGABLE (an un-occluded pixel), returning it + the
	 *  pressed pixel with the pointer left DOWN on it. On failure `target` is null and `diag` says why: the aim, the
	 *  pick target's own state, and whether the camera frames the graph at all. */
	private async pressFirstDraggable(page: Page): Promise<{ target: { id: string; x: number; y: number } | null; diag: string }> {
		// Settle BEFORE framing: an owed repaint re-places every node (a depth-basis switch re-derives z), so a fit taken
		// first frames a layout that is about to move out of it, and the view never re-frames itself, by design.
		await this.settle(page);
		await this.call(page, "rotateTo", ["xy"]); // the head-on frame: deterministic aim + scale before pixel-aiming (fit keeps an earlier scenario's orbit)
		await this.settle(page);
		const sample = (await this.fullInspect(page)).sample;
		if (sample.length === 0) return { target: null, diag: "the layout sample is empty (no nodes)" };
		await this.settleNodeProjection(page, sample[0].id); // the fit reframe animates AFTER the engine freezes, wait the projection still
		for (const s of sample) {
			const at = await this.pressOnNode(page, s.id); // leaves the pointer DOWN on the first un-occluded node
			if (at) return { target: { id: s.id, x: at.x, y: at.y }, diag: "" };
		}
		// No node was pickable, only NOW (the failure path) reconstruct why, so a normal call costs nothing. A miss is
		// either aim (the centre is off-canvas) or object (no pick target, or one the raycast skips), and the two want
		// opposite fixes, so the report names which: the pixel, what picks there, and the pick target's own state.
		const misses: string[] = [];
		for (const s of sample) {
			try {
				const c = await this.projectNode(page, s.id, 0);
				misses.push(`${s.id}@(${c.x.toFixed(0)},${c.y.toFixed(0)})→${(await this.pickAt(page, c.x, c.y)) ?? "∅"} ${await this.pickTargetState(page, s.id)}`);
			} catch {
				misses.push(`${s.id}→offscreen`);
			}
		}
		return {
			target: null,
			diag: `${sample.length} nodes, none pickable at centre (canvas ${await this.canvasRect(page)}, ${await this.frustumState(page)}): ${misses.slice(0, 8).join("  ")}`,
		};
	}

	/** What the raycast has to hit for a node: whether it has a sprite/pick target at all, whether that target is visible
	 *  (an invisible one is skipped), and where it sits versus the node the projection aimed at. */
	private pickTargetState(page: Page, id: string): Promise<string> {
		return page.evaluate((nid) => {
			const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { nodeMap: Map<string, Record<string, unknown>> };
			const n = el?.nodeMap?.get(nid) as
				| {
						x?: number;
						y?: number;
						z?: number;
						__sprite?: { visible?: boolean; position?: { x: number; y: number; z: number }; scale?: { x: number; y: number } };
						__visual?: { pickTarget?: { visible?: boolean } };
				  }
				| undefined;
			if (!n) return "[not in nodeMap]";
			const s = n.__sprite;
			if (!s) return "[no sprite]";
			const t = n.__visual?.pickTarget;
			const at = s.position ? `${s.position.x.toFixed(0)},${s.position.y.toFixed(0)},${s.position.z.toFixed(0)}` : "?";
			const node = `${(n.x ?? 0).toFixed(0)},${(n.y ?? 0).toFixed(0)},${(n.z ?? 0).toFixed(0)}`;
			return `[sprite vis=${s.visible} at=${at} node=${node} scale=${s.scale ? `${s.scale.x.toFixed(2)}x${s.scale.y.toFixed(2)}` : "?"} target=${t ? `yes vis=${t.visible}` : "sprite"}]`;
		}, id);
	}

	/** Whether the camera frames the nodes. A node behind the camera or past the far plane still projects to a
	 *  plausible pixel, the depth is what says so, and no forward ray can reach it, so an aim there can only miss. */
	private frustumState(page: Page): Promise<string> {
		return page.evaluate(() => {
			const el = document.querySelector("shu-polymorphic-graph-view") as unknown as {
				inspect(): { onScreen: { fraction: number; onScreen: number; total: number; span: number } | null; camera: { x: number; y: number; z: number; fov: number | null } | null };
			};
			const i = el?.inspect?.();
			const o = i?.onScreen;
			const c = i?.camera;
			return `onScreen=${o ? `${o.onScreen}/${o.total} span=${o.span.toFixed(2)}` : "null"} camera=${c ? `${c.x.toFixed(0)},${c.y.toFixed(0)},${c.z.toFixed(0)} fov=${c.fov ?? "?"}` : "null"}`;
		});
	}

	/** The render canvas' client rect: an aim is only meaningful inside it. */
	private canvasRect(page: Page): Promise<string> {
		return page.evaluate(() => {
			const c = document.querySelector("shu-polymorphic-graph-view canvas");
			if (!c) return "none";
			const r = c.getBoundingClientRect();
			return `${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`;
		});
	}

	/**
	 * Ensure the polymorphic view's settings are open, by clicking the column pane's controls toggle exactly as a reader does.
	 * The options render only while the settings are open, so any step driving one opens them first: the step can reach
	 * only what a reader can reach. Idempotent: it probes an option, never the toggle, so an already-open panel is left
	 * alone (the pane's toggle would close it).
	 */
	/** Tick or un-tick the named type chips, leaving every other type's visibility as it stands, as a reader does to the legend. */

	/** Show or hide a comma-separated set of chips through the filter's own public setter: one path for the types and
	 *  the properties, which differ only in which facet the filter is asked about. */
	private async setFilterChips(method: "setTypeVisibility" | "setPredicateVisibility", csv: string, visible: boolean) {
		const page = await this.page();
		await this.waitForNodes(page, 1);
		const list = csv
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		const ok = await this.callGraphFilter(page, method, [list, visible]);
		if (!ok) return actionNotOK("no graph filter on the view");
		await this.settleScopedRefetch(page);
		return actionOK();
	}

	/** What the view showed when each scene was saved in this run, so a later comparison has something to compare against. */
	private savedScenes = new Map<string, Record<string, Record<string, unknown>>>();

	/** The view's own record of how it is set up: the same reading a scene saves. */
	private captureGraphScene(page: Page): Promise<Record<string, Record<string, unknown>>> {
		return page.evaluate(() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { captureScene(): Record<string, Record<string, unknown>> }).captureScene());
	}

	/** Open one settings group's row via its head icon (the groups are exclusive, opening one closes another), then
	 *  wait for a control of that group to attach: what a reader can reach and what a step can drive are the same. */
	private async openSettings(page: Page, group: TSettingsGroup): Promise<void> {
		const iconId = POLYMORPHIC_IDS.SETTINGS[group];
		const probeId = SETTINGS_CONTROLS[group][0] ?? ""; // the filters group has no control of its own: its icon's pressed state is the answer
		const state = await page.evaluate(
			({ iconId, probeId }) => {
				const view = document.querySelector("shu-polymorphic-graph-view");
				if (!view) return "no view";
				if (probeId && view.querySelector(`[data-testid='${probeId}']`)) return "open";
				const icon = view.querySelector(`[data-testid='${iconId}']`) as HTMLElement | null;
				if (!icon) return "no icon";
				if (!probeId && icon.getAttribute("aria-pressed") === "true") return "open";
				icon.click();
				return "opening";
			},
			{ iconId, probeId },
		);
		if (state === "no view" || state === "no icon") throw new Error(`cannot open the polymorphic view ${group} settings: ${state}`);
		if (state === "open") return;
		if (probeId) await page.waitForFunction((id) => !!document.querySelector(`shu-polymorphic-graph-view [data-testid='${id}']`), probeId, { timeout: 5000 });
	}

	/** Drive the production view control to `value`, exactly as a person choosing it does. */
	private async selectView(page: Page, value: string): Promise<boolean> {
		await this.openSettings(page, "layout");
		return page.evaluate(
			({ v, viewId }) => {
				const sel = document.querySelector(`shu-polymorphic-graph-view [data-testid='${viewId}']`) as HTMLSelectElement | null;
				if (!sel) return false;
				sel.value = v;
				sel.dispatchEvent(new Event("change", { bubbles: true }));
				return true;
			},
			{ v: value, viewId: POLYMORPHIC_IDS.VIEW_TYPE },
		);
	}

	/** Fire the filter legend's type-preview (or clear it with null) at the view: the same event a legend hover sends. */
	private async dispatchPreview(page: Page, type: string | null): Promise<void> {
		await page.evaluate(
			(t) => document.querySelector("shu-polymorphic-graph-view")?.dispatchEvent(new CustomEvent("graph-type-preview", { detail: { type: t }, bubbles: true })),
			type,
		);
		await page.waitForTimeout(250); // the focus/dim repaint is debounced
	}

	/** Which node a press at these client pixels would pick, through the view's pickAt(), with no pointer side effects. */
	private pickAt(page: Page, x: number, y: number): Promise<string | null> {
		return page.evaluate(({ px, py }) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { pickAt(x: number, y: number): string | null }).pickAt(px, py), {
			px: x,
			py: y,
		});
	}
}

type FullInspect = {
	sample: Array<{ id: string; type: string; x: number; y: number; z: number; t: number | null; degree: number | null; fx: number | null; opacity: number | null; k: number }>;
	edges: Array<{ lineOpacity: number | null }>;
	focus: { hover: string | null; selected: string | null };
	azimuth: number | null;
	dragPending: string | null;
};

const range = (xs: number[]): number => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
const dist = (a: Array<{ id: string; x: number; y: number }>, b: Array<{ id: string; x: number; y: number }>, id: string): number => {
	const p = a.find((s) => s.id === id);
	const q = b.find((s) => s.id === id);
	return p && q ? Math.hypot(q.x - p.x, q.y - p.y) : 0;
};
