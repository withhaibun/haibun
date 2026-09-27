/**
 * Control + interaction steps for shu-polymorphic-graph-view, kept beside the element (the shu-graph-view.controls
 * pattern) so the graph's controls travel with the component. These are the GRAPH's own visual operations:
 * zoom/pan/orbit/fit, scope-to-type, reveal-a-node, hover, so feature tests for graphs read naturally
 * ("zoom in 50 pixels", "orbit 30 degrees left", "fit graph"). The functionality lives on the component
 * (zoomBy/panBy/orbitBy/fitGraph/openNode/setHoveredNode); this stepper drives it in the live app and reads inspect().
 *
 * Why component methods, not synthetic WebGL clicks: a Playwright pixel click does not reliably reach the lib's
 * raycaster headless (it emitted zero node clicks across every on-screen candidate). openNode() IS the real path a
 * click takes (onNodeClick → PANE_OPEN) and a genuine app entry point, so the open/resize/no-auto-zoom chain is
 * exercised faithfully. The lib's raycaster is the lib's concern, not this module's.
 *
 * Concern boundary: WHICH column is focused is the column browser's concern (shu-column-strip.controls), not here.
 *
 * The steps drive the page's main graph, `MAIN_GRAPH`: a graph a view embeds to draw its own data (`data-external`) is
 * its host's, and a page can hold several. A step reads what the graph draws through `state()`, calls it through
 * `call()`, waits on it through `until()`, and drives a control a person uses through Playwright's own actions.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import { SHU_TEST_IDS } from "../test-ids.js";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
import type { TPaneOpen } from "../pane-state.js";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps, type TFeatureStep } from "@haibun/core/lib/astepper.js";
import { DOMAIN_PERSISTED_TYPE, type TDomainDefinition } from "@haibun/core/lib/resources.js";
import { DOMAIN_NUMBER, DOMAIN_PERSISTED_TYPES, individualRefInputSchema, listedSchema, NameSchema } from "@haibun/core/lib/domains.js";
import { actionOK, actionNotOK, actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import type { TActionResult } from "@haibun/core/schema/protocol.js";
import { saveImageArtifact } from "@haibun/domain-storage/image-artifact.js";
import type { Locator, Page } from "playwright";
import { objectId } from "../object-id.js";
import { VIEW, VIEW_TYPES } from "../graph/polymorphic/polymorphic-views.js";
import { MEASURE_UNIT, PAN_DIRECTION, ZOOM_DIRECTION, type TMeasureUnit, type TPanDirection, type TZoomDirection } from "../graph/polymorphic/polymorphic-camera.js";
import type { ShuGraphScene, TGraphState } from "../graph/polymorphic/polymorphic-scene.js";
import { SETTINGS_GROUP, type TSettingsGroup } from "./view-head.js";
import type { ShuPolymorphicGraphView } from "./shu-polymorphic-graph-view.js";
import type { ShuGraphFilter } from "./shu-graph-filter.js";
import { NO_ELEMENT, ROUND_TRIP_MS, SETTLES_MS, STATE_MS, attached, comesToHold, controlledBrowser, controlledPage, percent, pollUntil, until } from "./controls-util.js";

/** The page's main graph: the one view that draws the page's own data. */
const MAIN_GRAPH = "shu-polymorphic-graph-view:not([data-external])";
const CLASS_BROWSER = `${SHU_TAG.TYPE_COLUMN} ${SHU_TAG.CLASS_BROWSER}`;
/** The schema the type column's class browser draws. */
const CLASS_BROWSER_SCENE = `${CLASS_BROWSER} ${SHU_TAG.GRAPH_SCENE}`;
/** A chip of a filter's legend, which a chip group draws. */
const FILTER_CHIP = `${SHU_TAG.CHIP_GROUP} label.chip`;
/** The types a schema's graph draws. */
const SCHEMA_TYPES = ["Class", "Property"];
/** The attribute the accessible reading marks each node's entry with. */
const NODE_ID_ATTR = "data-node-id";
const ARIA_PRESSED = "aria-pressed";
const PRESSED = "true";
/** The key that turns a press on a node into a camera orbit. */
const CAMERA_MODIFIER = "Control";
/** Between reads of a node count or a streamed arrival. */
const ARRIVAL_POLL_MS = 300;
const POLYMORPHIC_IDS = SHU_TEST_IDS.POLYMORPHIC_VIEW;
const FILTER_IDS = SHU_TEST_IDS.GRAPH_FILTER;
const NO_CANVAS = "the view doesn't hold a graph container to measure against";
const NO_NODE_TO_HOVER = "the graph doesn't draw a node to hover";
const NO_READING = "the scene doesn't hold an accessible graph document region";
const NO_FILTER = "the graph view doesn't hold a filter";
/** What a filter's chips show or hide: the graph's types, or the predicates its edges carry. */
const CHIP_FACET = { types: "types", predicates: "predicates" } as const;
type TChipFacet = (typeof CHIP_FACET)[keyof typeof CHIP_FACET];
/** The number of reads of the active node before the pointer step fails. A record arriving moves the node once. */
const ACTIVE_PICK_TRIES = 30;
const SCOPED_REFETCH_BEGIN_MS = 350; // covers the scoped refetch's RPC dispatch + the view's 250ms repaint debounce
/** A node or edge drawn above this opacity is lit, and one below `DIM_OPACITY` is dim. A node without an opacity is drawn full. */
const LIT_OPACITY = 0.9;
const DIM_OPACITY = 0.5;
const isLit = (opacity: number | null): boolean => (opacity ?? 1) > LIT_OPACITY;
const isDim = (opacity: number | null): boolean => (opacity ?? 1) < DIM_OPACITY;
/** The camera frames the graph when this share of its nodes projects on screen and the graph spans this share of the view. */
const FRAMED_ON_SCREEN = 0.9;
const FRAMED_SPAN = 0.2;
const HOVER_POP_MAX = 2.6; // a hover pop above this reads as "huge" (the regression): an independent ceiling, comfortably clear of the gentle magnify cap so a legit pop passes and a runaway one fails

/** The alpha a browser reports for a painted colour, in either shape it writes one: `rgba(r, g, b, a)` and the
 *  `color(srgb r g b / a)` a mixed colour comes back as. No alpha stated is opaque. */
export function paintedAlpha(background: string): number {
	const sliced = background.match(/\/\s*([\d.]+%?)\s*\)\s*$/)?.[1];
	if (sliced) return sliced.endsWith("%") ? Number.parseFloat(sliced) / 100 : Number.parseFloat(sliced);
	const parts = background.match(/^rgba?\(([^)]*)\)$/)?.[1]?.split(",");
	return parts && parts.length === 4 ? Number.parseFloat(parts[3]) : 1;
}

/** What each settings group holds, in row order: ONE table: the opener waits on the first control to attach, and the
 *  "every option is under its group" assertion checks the whole list. The filters group renders the shared filter
 *  element rather than controls of its own, so it doesn't name one. */
const SETTINGS_CONTROLS: Record<TSettingsGroup, string[]> = {
	[SETTINGS_GROUP.layout]: [
		POLYMORPHIC_IDS.ROTATE_XY,
		POLYMORPHIC_IDS.ROTATE_Z,
		POLYMORPHIC_IDS.VIEW_TYPE,
		POLYMORPHIC_IDS.GROUPED,
		POLYMORPHIC_IDS.GROUP_BY,
		POLYMORPHIC_IDS.FLATTEN,
		POLYMORPHIC_IDS.Z_BASIS,
		POLYMORPHIC_IDS.LABEL_AS_Z,
	],
	[SETTINGS_GROUP.filters]: [],
	[SETTINGS_GROUP.scenes]: [POLYMORPHIC_IDS.SCENE_PICKER, POLYMORPHIC_IDS.SCENE_NAME, POLYMORPHIC_IDS.SCENE_SAVE],
};

const DOMAIN_GRAPH_ZOOM = "graph-zoom-direction";
const ZoomDirSchema = z.enum(ZOOM_DIRECTION);
const DOMAIN_GRAPH_PAN = "graph-pan-direction";
const PanDirSchema = z.enum(PAN_DIRECTION);
const DOMAIN_GRAPH_UNIT = "graph-measure-unit";
const UnitSchema = z.enum(MEASURE_UNIT);
const DOMAIN_GRAPH_ZOOM_CMP = "graph-zoom-comparison";
const ZoomCmpSchema = z.enum(["closer", "farther"]);
const DOMAIN_GRAPH_CHANGE = "graph-change";
const ChangeSchema = z.enum(["changed", "unchanged"]);
const DOMAIN_GRAPH_GROUPING = "graph-grouping";
const GroupingSchema = z.enum(["group", "ungroup"]);
const DOMAIN_GRAPH_FLATTEN = "graph-flatten";
const FlattenSchema = z.enum(["flatten", "unflatten"]);
const DOMAIN_GRAPH_GROUP_AXIS = "graph-group-axis";
const GroupAxisSchema = z.enum(["role", "type"]);
const DOMAIN_GRAPH_VIEW = "graph-view-type";
const ViewTypeSchema = z.enum(VIEW_TYPES);
const DOMAIN_GRAPH_ZBASIS = "graph-z-basis";
/** What a feature line names a depth basis, and the value the view's control takes for it. */
const ZBASIS_VALUE = { "valid time": "valid", "indexed time": "indexed", connections: "connections" } as const;
const ZBasisSchema = z.enum(Object.keys(ZBASIS_VALUE) as [keyof typeof ZBASIS_VALUE, ...(keyof typeof ZBASIS_VALUE)[]]);

/** The domain of a graph still a step saved: where it is, and how many nodes it drew. */
const DOMAIN_GRAPH_STILL = "graph-still";
const GraphStillSchema = z.object({ path: z.string(), nodes: z.number() });
const DOMAIN_GRAPH_SNAPSHOT = "graph-snapshot";
const PointSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
// fov is not compared: it moves to hold worldPerPx, which is the zoom signal.
const CameraSchema = PointSchema.extend({ target: PointSchema.nullable().optional() }).nullable();
const ViewportSchema = z.object({ h: z.number(), w: z.number(), worldPerPx: z.number(), calibratedH: z.number() }).nullable();
const FramingSchema = z.object({ camera: CameraSchema, viewport: ViewportSchema, pos: z.record(z.string(), PointSchema) });
/** The graph at rest: its framing, and what it draws, which a feature compares through the variables and logic steps. */
const GraphSnapshotSchema = FramingSchema.extend({
	/** The node whose column is open, while the graph shows it. */
	active: z.string().nullable(),
	/** How many nodes wear the active highlight. */
	highlighted: z.number(),
	/** Whether the camera follows the node a reader chooses. */
	follow: z.boolean(),
	/** Whether the camera frames the whole graph at a usable size. */
	framed: z.boolean(),
	/** Whether a focus lights its neighbourhood and dims the rest. */
	focusDims: z.boolean(),
	/** The drawn nodes that a drawn edge doesn't touch. */
	isolated: z.array(z.string()),
	/** The predicates the drawn edges carry, each once. */
	predicates: z.array(z.string()),
	/** The titles of the boxes drawn around groups. */
	containers: z.array(z.string()),
	/** The pairs of group boxes that overlap on the x/y plane, each named by its two titles. */
	overlapping: z.array(z.string()),
	/** The area of the group boxes' bounding box over their summed area, while two or more boxes are drawn. */
	packing: z.number().nullable(),
	/** The lesser of the ranges the placed nodes span on x and on y. */
	extent: z.number(),
});
const DOMAIN_GRAPH_NODE = "graph-node";
const DOMAIN_GRAPH_PREDICATES = "graph-predicates";
const DOMAIN_GRAPH_DROP = "graph-drop";
const GraphDropSchema = z.object({ id: z.string(), x: z.number(), y: z.number() });
const DOMAIN_GRAPH_SCENE = "graph-scene";
/** The name a scene is saved under, which is the id of its record. */
const DOMAIN_SCENE_NAME = "scene-name";
const GraphSceneSchema = z.object({ name: z.string(), setup: z.record(z.string(), z.record(z.string(), z.unknown())) });
const graphControlDomains: TDomainDefinition[] = [
	{ selectors: [DOMAIN_GRAPH_STILL], schema: GraphStillSchema, description: "A graph still a step saved, and how many nodes it drew" },
	{ selectors: [DOMAIN_GRAPH_SNAPSHOT], schema: GraphSnapshotSchema, description: "The graph at rest: its framing, where it placed each node, and what it draws" },
	{
		selectors: [DOMAIN_GRAPH_NODE],
		schema: individualRefInputSchema,
		description: "A node the graph draws: its object id (type:id), the id of the record it draws, or words of the name it shows",
	},
	{
		selectors: [DOMAIN_GRAPH_PREDICATES],
		schema: listedSchema(z.string().min(1), "predicate"),
		description: "Predicates the graph's edges or its nodes' properties carry, by name, given as a list or as text separated by commas",
	},
	{ selectors: [DOMAIN_GRAPH_DROP], schema: GraphDropSchema, description: "A node a drag pinned, and where it was dropped" },
	{ selectors: [DOMAIN_GRAPH_SCENE], schema: GraphSceneSchema, description: "A scene a step saved, and how the view was set up when it was saved" },
	{ selectors: [DOMAIN_SCENE_NAME], schema: NameSchema, description: "The name a scene is saved under, which is the id of its record" },
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

type TFraming = z.infer<typeof FramingSchema>;
type Snapshot = z.infer<typeof GraphSnapshotSchema>;
type TGraphNode = { id: string };
type TGraphScene = z.infer<typeof GraphSceneSchema>;
type TSampled = TGraphState["sample"][number];
type TEnclosure = TGraphState["enclosures"][number];

export default class ShuPolymorphicGraphViewControls extends AStepper implements IHasCycles {
	description = "Drives the graph view in a page: finds, reveals, opens and drags nodes, filters by type, zooms, and checks what the graph shows.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: graphControlDomains }) };

	private page(): Promise<Page> {
		return controlledPage(this);
	}

	/** The page's main graph view. */
	private view(page: Page): Locator {
		return page.locator(MAIN_GRAPH);
	}

	/** What the main graph draws now: its inspect(), the one observable the steps read. */
	private async state(page: Page): Promise<TGraphState> {
		const state = await this.view(page).evaluate((view: ShuPolymorphicGraphView) => view.inspect());
		if (!state) throw new Error("the graph view's scene isn't mounted");
		return state;
	}

	/** Hover a node, or clear the hover with null: the path a pointer over the canvas takes. */
	private async hover(page: Page, id: string | null): Promise<void> {
		await this.view(page).evaluate((view: ShuPolymorphicGraphView, nid) => view.setHoveredNode(nid), id);
	}

	/** Aim the camera head-on at the graph's plane, a deterministic frame to aim the pointer in. */
	private async headOn(page: Page): Promise<void> {
		await this.view(page).evaluate((view: ShuPolymorphicGraphView) => view.rotateTo("xy"));
	}

	/** Show the merged schema alongside the live data, or hide it, and wait for the refetch to land. */
	private async revealSchema(page: Page, visible: boolean): Promise<void> {
		await this.view(page).evaluate((view: ShuPolymorphicGraphView, on) => view.revealSchema(on), visible);
		await this.settleScopedRefetch(page);
	}

	/** Move the shared time cursor, or clear it with null. */
	private async setTimeCursor(page: Page, at: number | null): Promise<void> {
		await this.view(page).evaluate((view: ShuPolymorphicGraphView, ms) => view.setTimeCursor(ms), at);
	}

	/** Open a node through the graph's own reveal path, the one a click on the canvas takes. */
	private async openNode(page: Page, id: string): Promise<void> {
		await this.view(page).evaluate((view: ShuPolymorphicGraphView, nid) => view.openNode(nid), id);
	}

	/** Wait until `test` holds of the main graph. */
	private untilGraph<A>(page: Page, test: (on: { el: ShuPolymorphicGraphView; arg: A }) => boolean, arg: A, timeout?: number): Promise<void> {
		return until(this.view(page), test, arg, timeout);
	}

	/** Whether `test` comes to hold of the main graph within `timeout`. */
	private comesToHold<A>(page: Page, test: (on: { el: ShuPolymorphicGraphView; arg: A }) => boolean, arg: A, timeout: number): Promise<boolean> {
		return comesToHold(this.view(page), test, arg, timeout);
	}

	/** The graph's framing and where it placed each node. */
	private async framing(page: Page): Promise<TFraming> {
		return framingOf(await this.state(page));
	}

	/** The graph as `snapshot the graph` records it: its framing and what it draws. */
	private async snapshot(page: Page): Promise<Snapshot> {
		const state = await this.state(page);
		const { focus, highlighted, follow, onScreen, sample, edges, enclosures } = state;
		const drawn = await this.view(page).evaluate((view: ShuPolymorphicGraphView) => [...(view.nodeMap?.keys() ?? [])]);
		const linked = new Set(edges.flatMap((e) => [e.s, e.t]));
		const lit = sample.filter((n) => isLit(n.opacity)).length;
		const dim = sample.filter((n) => isDim(n.opacity)).length;
		return {
			...framingOf(state),
			active: focus.selected,
			highlighted,
			follow,
			framed: !!onScreen && onScreen.fraction >= FRAMED_ON_SCREEN && onScreen.span >= FRAMED_SPAN,
			focusDims: (!!focus.hover || !!focus.selected) && dim > 0 && lit > 0 && lit < sample.length,
			isolated: drawn.filter((id) => !linked.has(id)),
			predicates: [...new Set(edges.map((e) => e.predicate))],
			containers: enclosures.map((e) => e.title),
			overlapping: overlappingPairs(enclosures),
			packing: enclosures.length < 2 ? null : packingOf(enclosures),
			extent: Math.min(range(sample.map((n) => placed(n).x)), range(sample.map((n) => placed(n).y))),
		};
	}

	/** Wait for the view at rest: the layout has stopped spreading, the camera is calibrated to the canvas, no newcomer
	 *  wears its welcome glow, no chip's text is still to land, and the frames those changes schedule are drawn. */
	private async atRest(page: Page): Promise<void> {
		await this.waitForLayoutStable(page);
		await this.waitForCalibratedViewport(page);
		await this.untilGraph(
			page,
			({ el }) => {
				const render = el.inspect()?.render;
				return render?.welcoming === 0 && render.layingOut === 0;
			},
			null,
			STATE_MS,
		);
		await this.frames(page);
	}

	/** Block until the graph holds at least `min` nodes. The scene mounts before its first data feed, so its test ids
	 *  resolve before it holds any. */
	private waitForNodes(page: Page, min: number): Promise<void> {
		return this.untilGraph(page, ({ el, arg }) => (el.inspect()?.nodes ?? 0) >= arg, min);
	}

	/** Wait for the layout and the camera to come to rest, so a read is stable and a camera op is not raced by a settling
	 *  tween or by following's check after a pan or zoom. A debounced repaint that has not run leaves the engine idle
	 *  while the scene still shows the previous placement, so settled means the engine and the camera are at rest AND the view doesn't owe a repaint. */
	private settle(page: Page): Promise<void> {
		return this.untilGraph(
			page,
			({ el }) => {
				const i = el.inspect();
				return !!i && i.engineMode === "frozen" && i.tween === null && !i.repaintPending && !i.followPending;
			},
			null,
		);
	}

	/** Wait for the scene to run `count` more frames: a change scheduled for the next frame has been drawn by then. */
	private async frames(page: Page, count = 2): Promise<void> {
		const from = (await this.state(page)).render.ticks;
		await this.untilGraph(page, ({ el, arg }) => (el.inspect()?.render.ticks ?? 0) >= arg, from + count, STATE_MS);
	}

	/** Wait for the group containers, which the graph draws a frame or two after its layout settles. */
	private groupsDrawn(page: Page): Promise<void> {
		return this.untilGraph(page, ({ el }) => (el.inspect()?.enclosures.length ?? 0) > 0, null, SETTLES_MS);
	}

	/** Read `read` until two reads in a row are `stable`, running `beforeEach` (such as a settle) before every read. */
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
		await this.pollUntilStable(
			page,
			ARRIVAL_POLL_MS,
			12,
			async () => (await this.state(page)).nodes,
			(now, prev) => now === prev,
		);
	}

	/** A type-scope change refetches (RPC + repaint debounce) and can land in two stages (hide → refetch): give the
	 *  refetch time to begin, then wait until the node count stops changing. */
	private async settleScopedRefetch(page: Page): Promise<void> {
		await page.waitForTimeout(SCOPED_REFETCH_BEGIN_MS);
		await this.settle(page);
		await this.waitForStableCount(page);
	}

	/** Wait until the camera's fov is calibrated to the canvas height it has now. A window or column resize lands on the
	 *  canvas first and the fov compensation follows on the ResizeObserver, so a framing read between the two sees
	 *  worldPerPx scaled by the height change and mistakes it for a zoom. */
	private waitForCalibratedViewport(page: Page): Promise<void> {
		return this.untilGraph(
			page,
			({ el }) => {
				const v = el.inspect()?.viewport;
				return !!v && v.h > 0 && v.h === v.calibratedH;
			},
			null,
			STATE_MS,
		);
	}

	/** Wait until the force layout STOPS spreading: the engine is frozen AND the world-space bbox radius has stopped
	 *  growing across consecutive polls. A from-scratch layout settles to its full extent over several engine stops with a
	 *  STABLE node count, so settle() (frozen) and waitForStableCount (count) both return mid-spread; the auto-fit follows
	 *  the spread, so any assertion about a SETTLED camera (hover-doesn't-move, fits-the-view) must wait for this. */
	private async waitForLayoutStable(page: Page): Promise<void> {
		await this.pollUntilStable(
			page,
			250,
			16,
			async () => (await this.state(page)).bboxRadius,
			(now, prev) => Math.abs(now - prev) < 0.5,
			() => this.settle(page),
		);
	}

	/**
	 * The bare id of the live node a {match} handle names: its objectId `type:id`, its bare id, or a substring of its name.
	 * A streamed arrival lands a beat after the store write, so the lookup waits for it, and throws where the graph doesn't hold it.
	 */
	private async nodeId(page: Page, match: string): Promise<string> {
		await this.waitForNodes(page, 1);
		const find = async () =>
			(await this.view(page).evaluate((view: ShuPolymorphicGraphView) => [...(view.nodeMap?.values() ?? [])].map((n) => ({ id: n.id, type: n.type, name: n.name })))).find(
				(n) => objectId(n.type, n.id) === match || n.id === match || n.name?.includes(match),
			)?.id;
		const id = await pollUntil(page, find, (found) => found !== undefined, 30, ARRIVAL_POLL_MS);
		if (!id) throw new Error(`the graph doesn't hold node "${match}"`);
		return id;
	}

	/** Every node the graph draws, and every edge. */
	/** Every chip the filter shows, across its groups, and whether each is ticked. */
	private chipStates(page: Page): Promise<Array<{ label: string; checked: boolean }>> {
		return this.filter(page)
			.locator(FILTER_CHIP)
			.evaluateAll((chips) => chips.map((chip) => ({ label: (chip.textContent ?? "").trim(), checked: !!chip.querySelector<HTMLInputElement>("input")?.checked })));
	}

	/** Whether a node projects inside the central half of the canvas, which is what following promises a reader: the
	 *  one measurement, whether the reader reached the node on the canvas or opened it in a column. */
	private async centresNode(page: Page, id: string): Promise<TActionResult> {
		await this.settle(page);
		await this.settleNodeProjection(page, id); // the follow re-frame animates after the engine freezes
		const at = await this.projectNode(page, id, 0); // client (page) coordinates: the same space the pointer uses
		const rect = await page.getByTestId(POLYMORPHIC_IDS.GRAPH_CONTAINER).boundingBox();
		if (!rect) return actionNotOK(NO_CANVAS);
		const dx = Math.abs(at.x - (rect.x + rect.width / 2));
		const dy = Math.abs(at.y - (rect.y + rect.height / 2));
		if (dx > rect.width / 4 || dy > rect.height / 4) {
			const { camera } = await this.framing(page);
			return actionNotOK(
				`active node "${id}" projects (${dx.toFixed(0)},${dy.toFixed(0)}) from the canvas centre of ${rect.width}×${rect.height}; camera=${JSON.stringify(camera)}`,
			);
		}
		return actionOK();
	}

	/** Where the view draws a node, read from the view's own projection: the same one the pick inverts, so an aim here
	 *  lands on that node. `nudgeX` offsets the aim along x to clear a neighbour's chip. */
	private async projectNode(page: Page, id: string, nudgeX = 12): Promise<{ x: number; y: number }> {
		const at = await this.view(page).evaluate((view: ShuPolymorphicGraphView, nid) => view.projectNodeToScreen(nid), id);
		if (!at) throw new Error(`node ${id} has no projection, absent from the graph, or the scene has no camera yet`);
		return { x: at.x + nudgeX, y: at.y };
	}

	/** What changed between two graph snapshots (plus the hovered node's magnify k), empty = the graph is unchanged.
	 *  Reports each moved signal so a "graph changed on hover/click" regression is diagnosable: scale, zoom, camera, layout. */
	private graphMoved(before: TFraming, after: TFraming, k: number): string[] {
		const problems: string[] = [];
		if (k > 1.05) problems.push(`node magnified ${k.toFixed(2)}×`);
		if (before.viewport && after.viewport) {
			const zoom = Math.abs(after.viewport.worldPerPx - before.viewport.worldPerPx) / before.viewport.worldPerPx;
			if (zoom > 0.02) problems.push(`zoom (worldPerPx) shifted ${percent(zoom)}`);
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

	/** The node's live magnify multiplier (1 = resting). */
	private async hoveredK(page: Page, id: string): Promise<number> {
		return (await this.state(page)).sample.find((s) => s.id === id)?.k ?? 1;
	}

	/** Read the node's magnify until it holds still: the pop animates in and out over several frames. */
	private async steadyK(page: Page, id: string): Promise<number> {
		await this.pollUntilStable(
			page,
			100,
			15,
			() => this.hoveredK(page, id),
			(now, prev) => Math.abs(now - prev) < 0.01,
		);
		return this.hoveredK(page, id);
	}

	steps: TStepperSteps = {
		waitForGraphNodes: {
			gwta: `graph has at least {count: ${DOMAIN_NUMBER}} nodes`,
			action: async ({ count }: { count: number }) => {
				await this.waitForNodes(await this.page(), count);
				return actionOK();
			},
		},
		waitForGraphNode: {
			// Wait for a specific node to stream in (a live arrival after a mid-run data write): the streamed-arrival witness.
			gwta: `graph shows node {match: ${DOMAIN_GRAPH_NODE}}`,
			action: async ({ match: { id: match } }: { match: TGraphNode }) => {
				const page = await this.page();
				await this.nodeId(page, match);
				await this.settle(page); // the arrival reheats the layout; wait for it to settle before any assert
				await this.frames(page); // focus is applied a frame after the engine freezes
				return actionOK();
			},
		},
		clickGraphNode: {
			// Click a node via the production reveal path (openNode → onNodeClick) WITHOUT asserting the pane it opens: in the
			// ontology view a node opens a windowed-instances pane (PANE_OPEN → filter-prop), not an entity column. The
			// column-browser stepper (activeColumnMatches) waits for the pane that opened. NOT "click …": that collides with
			// web-playwright's generic "click {target}".
			gwta: `reveal graph node {match: ${DOMAIN_GRAPH_NODE}}`,
			action: async ({ match: { id: match } }: { match: TGraphNode }) => {
				const page = await this.page();
				const id = await this.nodeId(page, match);
				await this.openNode(page, id);
				return actionOK();
			},
		},
		filterToGraphType: {
			gwta: `filter to graph type {type: ${DOMAIN_PERSISTED_TYPE}}`,
			action: async ({ type }: { type: string }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				return this.showOnlyType(page, type);
			},
		},
		untickGraphTypes: {
			// Un-tick the named type chips, leaving every other type's visibility as it stands.
			gwta: `untick graph chips {types: ${DOMAIN_PERSISTED_TYPES}}`,
			action: ({ types }: { types: string[] }) => this.setFilterChips(CHIP_FACET.types, types, false),
		},
		tickGraphTypes: {
			// The other half of the chip pair: tick the named type chips back on, leaving every other type as it stands.
			gwta: `tick graph chips {types: ${DOMAIN_PERSISTED_TYPES}}`,
			action: ({ types }: { types: string[] }) => this.setFilterChips(CHIP_FACET.types, types, true),
		},
		soloTypeViaTool: {
			gwta: `solo graph type {type: ${DOMAIN_PERSISTED_TYPE}} via the 1️⃣ tool`,
			action: async ({ type }: { type: string }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				const filter = await this.filterControls(page);
				await filter.getByTestId(FILTER_IDS.SOLO).click(); // select the tool, so the next chip click solos its type
				const chip = filter.locator(FILTER_CHIP).filter({ hasText: new RegExp(`^\\s*${type}\\b`) });
				if ((await chip.count()) === 0) return actionNotOK(`the filter doesn't show a type chip for ${type}`);
				await chip.first().click(); // tap the type → show only it
				await this.settleScopedRefetch(page);
				return actionOK();
			},
		},
		zoomGraph: {
			gwta: `zoom {dir: ${DOMAIN_GRAPH_ZOOM}} {amount: ${DOMAIN_NUMBER}} {unit: ${DOMAIN_GRAPH_UNIT}}`,
			action: async ({ dir, amount, unit }: { dir: TZoomDirection; amount: number; unit: TMeasureUnit }) => {
				const page = await this.page();
				await this.settle(page);
				await this.view(page).evaluate((view: ShuPolymorphicGraphView, a) => view.zoomBy(a.amount, a.unit, a.dir), { amount, unit, dir });
				return actionOK();
			},
		},
		panGraph: {
			gwta: `pan {amount: ${DOMAIN_NUMBER}} {unit: ${DOMAIN_GRAPH_UNIT}} {dir: ${DOMAIN_GRAPH_PAN}}`,
			action: async ({ amount, unit, dir }: { amount: number; unit: TMeasureUnit; dir: TPanDirection }) => {
				const page = await this.page();
				await this.settle(page);
				await this.view(page).evaluate((view: ShuPolymorphicGraphView, a) => view.panBy(a.amount, a.unit, a.dir), { amount, unit, dir });
				return actionOK();
			},
		},
		orbitGraph: {
			gwta: `orbit {degrees: ${DOMAIN_NUMBER}} degrees {dir: ${DOMAIN_GRAPH_PAN}}`,
			action: async ({ degrees, dir }: { degrees: number; dir: TPanDirection }) => {
				const page = await this.page();
				await this.settle(page);
				await this.view(page).evaluate((view: ShuPolymorphicGraphView, a) => view.orbitBy(a.degrees, a.dir), { degrees, dir });
				return actionOK();
			},
		},
		fitGraph: {
			gwta: "fit graph",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				await this.view(page).evaluate((view: ShuPolymorphicGraphView) => view.fitGraph());
				return actionOK();
			},
		},
		toggleGraphFollow: {
			// The head's follow toggle, pressed as a person presses it. While on, the camera keeps the active (selected)
			// node centred and readable through selection changes and re-layouts.
			gwta: "toggle graph follow",
			action: async () => {
				const button = (await this.page()).getByTestId(POLYMORPHIC_IDS.FOLLOW);
				const was = (await button.getAttribute(ARIA_PRESSED)) === PRESSED;
				await button.click();
				const now = (await button.getAttribute(ARIA_PRESSED)) === PRESSED;
				if (now === was) return actionNotOK(`the follow toggle did not change state (aria-pressed stays ${now})`);
				return actionOK();
			},
		},
		untickGraphProperties: {
			// Un-tick predicate chips in the filter's properties group: those edges leave the model, so every medium
			// (the 3D view, the sequence, the still, the accessible document) draws the same reduced edge set.
			gwta: `untick graph properties {predicates: ${DOMAIN_GRAPH_PREDICATES}}`,
			action: ({ predicates }: { predicates: string[] }) => this.setFilterChips(CHIP_FACET.predicates, predicates, false),
		},
		tickGraphProperties: {
			gwta: `tick graph properties {predicates: ${DOMAIN_GRAPH_PREDICATES}}`,
			action: ({ predicates }: { predicates: string[] }) => this.setFilterChips(CHIP_FACET.predicates, predicates, true),
		},
		toggleGraphPrune: {
			// The head's prune toggle: nodes without a visible edge leave the model, in every medium.
			gwta: "toggle graph prune",
			action: async () => {
				const page = await this.page();
				await page.getByTestId(POLYMORPHIC_IDS.PRUNE).click();
				await this.settle(page);
				return actionOK();
			},
		},
		graphCentresActive: {
			// Follow's observable contract: the named node is the active node, and it projects inside the central half of the canvas.
			gwta: `graph centres the active node {node: ${DOMAIN_GRAPH_NODE}}`,
			action: async ({ node }: { node: TGraphNode }) => {
				const page = await this.page();
				const id = await this.nodeId(page, node.id);
				if (!(await this.becomesSelected(page, id))) return actionNotOK(`graph node "${id}" is not the active node: ${(await this.state(page)).focus.selected} is`);
				return await this.centresNode(page, id);
			},
		},
		clickGuideEntry: {
			// The guide's own activation path: a real click on the reading's entry for a node, focus lands in the guide
			// (which is what makes the follow aim beside it), and the click drives the same open a pointer on the canvas does.
			gwta: `open guide entry {match: ${DOMAIN_GRAPH_NODE}}`,
			productsDomain: DOMAIN_GRAPH_NODE,
			action: async ({ match: { id: match } }: { match: TGraphNode }) => {
				const page = await this.page();
				await this.settle(page);
				const id = await this.nodeId(page, match);
				const entry = page.getByTestId(POLYMORPHIC_IDS.A11Y).locator(`ol > li > [${NODE_ID_ATTR}="${id}"]`).first();
				if ((await entry.count()) === 0) return actionNotOK(`the guide doesn't list an entry for "${id}"`);
				await entry.click();
				return actionOKWithProducts({ id });
			},
		},
		graphActiveInClear: {
			// Following with something over the view: the chosen node lands ON the canvas and OUT from under whatever
			// covers it, the reading guide and any panel that declares it covers the views. Centred under one of them, or
			// pushed past the edge by a column-open resize, the reader was shown nothing.
			gwta: `graph shows the active node {node: ${DOMAIN_GRAPH_NODE}} clear of what covers it`,
			action: async ({ node }: { node: TGraphNode }) => {
				const page = await this.page();
				const id = await this.nodeId(page, node.id);
				await this.settle(page);
				await this.settleNodeProjection(page, id);
				const at = await this.projectNode(page, id, 0);
				const canvas = await page.getByTestId(POLYMORPHIC_IDS.GRAPH_CONTAINER).boundingBox();
				if (!canvas) return actionNotOK(NO_CANVAS);
				if (at.x < canvas.x || at.x > canvas.x + canvas.width || at.y < canvas.y || at.y > canvas.y + canvas.height)
					return actionNotOK(`active node "${id}" projects (${at.x.toFixed(0)},${at.y.toFixed(0)}) off the ${canvas.width}×${canvas.height} canvas at (${canvas.x},${canvas.y})`);
				// What covers the view, read the way the scene reads it: the guide of this graph, and every panel saying so.
				const covers = await page.evaluate((guideId) => {
					const guide = document.querySelector<HTMLElement>(`[data-testid="${guideId}"]`);
					const showing = guide && (guide.hasAttribute("data-shown") || guide.matches(":focus-within")) ? [guide] : [];
					return [...showing, ...Array.from(document.querySelectorAll<HTMLElement>("[data-covers-views]"))].map((el) => {
						const r = el.getBoundingClientRect();
						return { what: el.tagName.toLowerCase(), x: r.x, y: r.y, w: r.width, h: r.height };
					});
				}, POLYMORPHIC_IDS.A11Y);
				const under = covers.find((c) => at.x >= c.x && at.x <= c.x + c.w && at.y >= c.y && at.y <= c.y + c.h);
				if (under)
					return actionNotOK(`active node "${id}" sits under the ${under.what} (${under.w.toFixed(0)}×${under.h.toFixed(0)} at ${under.x.toFixed(0)},${under.y.toFixed(0)})`);
				return actionOK();
			},
		},
		fitGraphAround: {
			// Frame a node + its 1-hop neighbours so a doc/tour feature can jump straight to a node's local context.
			gwta: `fit graph around {node: ${DOMAIN_GRAPH_NODE}}`,
			action: async ({ node }: { node: TGraphNode }) => {
				const page = await this.page();
				const id = await this.nodeId(page, node.id);
				await this.settle(page);
				await this.view(page).evaluate((view: ShuPolymorphicGraphView, nid) => view.fitGraphAround(nid), id);
				return actionOK();
			},
		},
		openGraphNode: {
			// Open a node's column via the production reveal path (onNodeClick → PANE_OPEN) and prove the graph
			// emitted open-for-that-node. Returns the node opened, so a later step can target the same node.
			gwta: `open graph node {match: ${DOMAIN_GRAPH_NODE}}`,
			productsDomain: DOMAIN_GRAPH_NODE,
			action: async ({ match: { id: match } }: { match: TGraphNode }) => {
				const page = await this.page();
				await this.settle(page);
				const id = await this.nodeId(page, match);
				const subject = await this.view(page).evaluate(
					(view: ShuPolymorphicGraphView, { nid, evt }) => {
						const asked: { id: string | null } = { id: null };
						document.addEventListener(
							evt,
							(e) => {
								const { pane } = (e as CustomEvent<TPaneOpen>).detail;
								asked.id = pane.paneType === "entity" ? pane.id : null;
							},
							{ once: true, capture: true },
						);
						view.openNode(nid);
						return asked.id;
					},
					{ nid: id, evt: SHU_EVENT.PANE_OPEN },
				);
				if (subject !== id) return actionNotOK(`opening graph node "${id}" did not ask to open its column (got ${subject})`);
				// Opening round-trips through the page (PANE_OPEN → the pane → the active record → the view), so the node becomes
				// the active node after the call returns. A node that never does was not opened, and the scene settles once the
				// column it opened has resized the view.
				if (!(await this.becomesSelected(page, id)))
					return actionNotOK(`opening graph node "${id}" did not make it the active node: ${(await this.state(page)).focus.selected} is`);
				await this.settle(page);
				return actionOKWithProducts({ id });
			},
		},
		pickActiveGraphNode: {
			// Click the active node with the real pointer on the canvas. The click event reaches the whole page, so an
			// actions bar that closes on a click elsewhere closes. `open graph node` calls the view directly and dispatches
			// no click. The follow keeps the active node in clear view, and the step reads its id from the view, because
			// the run assigns the id of a conversation's comment. The step reads the active node again until its projection
			// is still and a pixel picks it, because a record arriving can move it. The phrase avoids "click", which
			// web-playwright's "click {target}" matches.
			gwta: "pick the active graph node with the pointer",
			productsDomain: DOMAIN_GRAPH_NODE,
			action: async () => {
				const page = await this.page();
				for (let tries = 0; tries < ACTIVE_PICK_TRIES; tries++) {
					await this.settle(page);
					const id = (await this.state(page)).focus.selected;
					if (!id) return actionNotOK("the graph doesn't have an active node to pick");
					await this.settleNodeProjection(page, id);
					const at = (await this.state(page)).focus.selected === id ? await this.aimAtNode(page, id) : null;
					if (!at) continue;
					await page.mouse.click(at.x, at.y);
					if (await this.becomesSelected(page, id)) return actionOKWithProducts({ id });
					return actionNotOK(`clicking graph node "${id}" at (${at.x.toFixed(0)},${at.y.toFixed(0)}) did not select it: selected is ${(await this.state(page)).focus.selected}`);
				}
				const { sample } = await this.state(page);
				return actionNotOK(`the active graph node never held still where the pointer could pick it ${await this.unpickableReport(page, sample)}`);
			},
		},
		hoverNode: {
			gwta: `hover the {node: ${DOMAIN_GRAPH_NODE}} node`,
			action: async ({ node }: { node: TGraphNode }) => {
				const page = await this.page();
				const id = await this.nodeId(page, node.id);
				await this.hover(page, id);
				return actionOK();
			},
		},
		movePointerOff: {
			// Clear the hover while the node stays selected and its column active: the user's exact "moved off the
			// focus node, still the active column but no longer hovered" sequence, which must not shift the framing.
			gwta: "move the pointer off the graph",
			action: async () => {
				await this.hover(await this.page(), null);
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
				const before = await this.framing(page);
				const id = (await this.state(page)).sample[0]?.id;
				if (!id) return actionNotOK(NO_NODE_TO_HOVER);
				await this.hover(page, id);
				const k = await this.steadyK(page, id);
				if (k > HOVER_POP_MAX) return actionNotOK(`hover popped the node to ${k.toFixed(1)}×, far past a readable size; the pop must stay bounded`);
				const moved = this.graphMoved(before, await this.framing(page), 1);
				if (moved.length) return actionNotOK(`hover moved the view/layout: ${moved.join("; ")}: a hover must scale only the node`);
				await this.hover(page, null);
				const off = await this.steadyK(page, id);
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
				const id = (await this.state(page)).sample[0]?.id;
				if (!id) return actionNotOK(NO_NODE_TO_HOVER);
				const c = await this.projectNode(page, id);
				await page.mouse.move(c.x - 20, c.y); // pointer onto the canvas → sets pointerOverCanvas via the canvas pointermove handler
				const kBefore = await this.steadyK(page, id); // settle any residual magnify before the baseline
				const before = await this.framing(page);
				for (let i = 0; i < 16; i++) {
					// jiggle a REAL pointer over the node for ~1.3s: the user's hover condition (no button)
					await page.mouse.move(c.x + (i % 2 ? 5 : -5), c.y + (i % 3 ? 3 : -3));
					await page.waitForTimeout(80);
				}
				const pop = 1 + Math.max(0, (await this.hoveredK(page, id)) - kBefore);
				if (pop > HOVER_POP_MAX) return actionNotOK(`real pointer popped the node ${pop.toFixed(2)}×, past a readable size`);
				// The node's own bounded hover-pop is intended; feed graphMoved k=1 so ONLY a camera/zoom/layout drift fails.
				const problems = this.graphMoved(before, await this.framing(page), 1);
				return problems.length === 0 ? actionOK() : actionNotOK(`real pointer over the graph moved it: ${problems.join("; ")}`);
			},
		},
		snapshotGraph: {
			gwta: "snapshot the graph",
			productsDomain: DOMAIN_GRAPH_SNAPSHOT,
			action: async () => {
				const page = await this.page();
				// A baseline of a SETTLED graph: the auto-fit follows the spreading layout, so a mid-spread baseline would read as a later "re-frame".
				await this.atRest(page);
				return actionOKWithProducts(await this.snapshot(page));
			},
		},
		graphView: {
			// The framing assertion, both directions in one step. "unchanged" is the auto-zoom guard: fov, camera
			// position, and the zoom level (worldPerPx) all held since the snapshot, used after a click/hover/move-off,
			// where the graph must NOT re-decide its own framing. "changed" confirms a sanctioned pan/orbit/fit moved it.
			// Node positions are not checked: opening a node may legitimately bring in data; only the framing is pinned.
			gwta: `graph view is {state: ${DOMAIN_GRAPH_CHANGE}} since {before: ${DOMAIN_GRAPH_SNAPSHOT}}`,
			action: async ({ state, before }: { state: string; before: Snapshot }) => {
				if (!before.camera || !before.viewport) return actionNotOK("the graph snapshot doesn't hold a framing");
				const page = await this.page();
				await this.waitForCalibratedViewport(page);
				const after = await this.framing(page);
				if (!after.camera || !after.viewport) return actionNotOK("the graph doesn't have a live framing");
				// The zoom LEVEL is worldPerPx, not fov: fov is ALLOWED to change to hold worldPerPx across a box-height
				// change (the no-auto-zoom compensation). A re-frame is a camera-position move (pan/orbit/fit) or a real
				// worldPerPx change (a zoom), never the fov adjustment that keeps content the same apparent size.
				const camDrift = Math.hypot(after.camera.x - before.camera.x, after.camera.y - before.camera.y, after.camera.z - before.camera.z);
				const zoomDrift = Math.abs(after.viewport.worldPerPx - before.viewport.worldPerPx) / before.viewport.worldPerPx;
				const moved = camDrift > 1 || zoomDrift > 0.01;
				const drift = `posΔ=${camDrift.toFixed(2)} zoomΔ=${percent(zoomDrift, 1)}`;
				if (state === ChangeSchema.enum.unchanged)
					return moved ? actionNotOK(`graph re-framed itself since the snapshot: ${drift} (canvas h ${before.viewport.h}→${after.viewport.h}): it must not auto-zoom`) : actionOK();
				return moved ? actionOK() : actionNotOK(`graph view did not change since the snapshot (${drift})`);
			},
		},
		graphLayoutSteady: {
			// Node WORLD positions barely moved since the snapshot: the layout did not wiggle/reheat. This is the
			// "bananas" guard, distinct from framing: the camera can hold steady while nodes churn under rapid focus switches.
			gwta: `graph layout is steady since {before: ${DOMAIN_GRAPH_SNAPSHOT}}`,
			action: async ({ before }: { before: Snapshot }) => {
				const after = await this.framing(await this.page());
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
				return maxDrift <= 2
					? actionOK()
					: actionNotOK(`graph layout moved since the snapshot (node ${worst} drifted ${maxDrift.toFixed(2)}), switching focus disturbed the layout`);
			},
		},
		graphZoom: {
			gwta: `graph zoom is {comparison: ${DOMAIN_GRAPH_ZOOM_CMP}} than {before: ${DOMAIN_GRAPH_SNAPSHOT}}`,
			action: async ({ comparison, before }: { comparison: string; before: Snapshot }) => {
				if (!before.viewport) return actionNotOK("the graph snapshot doesn't hold a viewport");
				const after = await this.framing(await this.page());
				if (!after.viewport) return actionNotOK("the graph doesn't have a live viewport");
				const ratio = after.viewport.worldPerPx / before.viewport.worldPerPx; // worldPerPx smaller = closer (more zoomed in)
				if (comparison === ZoomCmpSchema.enum.closer) return ratio < 0.99 ? actionOK() : actionNotOK(`graph did not zoom in since the snapshot (worldPerPx ×${ratio.toFixed(3)})`);
				return ratio > 1.01 ? actionOK() : actionNotOK(`graph did not zoom out since the snapshot (worldPerPx ×${ratio.toFixed(3)})`);
			},
		},
		focusFirstNode: {
			// Focus the first node WITHOUT settling first, reproduces a focus during/right after the initial render.
			gwta: "focus the first graph node",
			action: async () => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				const id = (await this.state(page)).sample[0]?.id;
				if (!id) return actionNotOK("the graph doesn't draw a node to focus");
				await this.hover(page, id);
				return actionOK();
			},
		},
		dragGraphNode: {
			// A real press-drag-release through the polymorphic view's own pointer handlers (which DO receive synthetic pointer events,
			// unlike the lib's click raycaster). Deterministic: it drags whichever node the view reports DRAGGABLE (un-occluded)
			// rather than a fixed id: the frontmost node is always pickable, so a non-deterministic layout can't leave the
			// target buried. The drag GEOMETRY (track/pin/release) is unit-tested in polymorphic-drag.test.ts; this only smoke-tests
			// the DOM→handler wiring: the dragged node tracks the pointer + pins, others hold still. Returns the node and where it was dropped.
			gwta: "drag a node",
			productsDomain: DOMAIN_GRAPH_DROP,
			action: async () => {
				const page = await this.page();
				const { target, diag } = await this.pressFirstDraggable(page);
				if (!target) return actionNotOK(`no draggable node, ${diag}`);
				const before = await this.state(page); // after the press (which doesn't move a node), so "others hold still" measures only the drag
				await page.mouse.move(target.x + 120, target.y + 60, { steps: 8 }); // well past the drag threshold (pointer already down on the node)
				await page.mouse.up();
				await this.untilGraph(page, ({ el }) => el.inspect()?.drag === null, null, STATE_MS);
				const after = await this.state(page);
				const moved = dist(before.sample, after.sample, target.id);
				if (moved <= 15) return actionNotOK(`the dragged node "${target.id}" did not track the pointer (moved ${moved.toFixed(1)})`);
				const others = after.sample
					.filter((s) => s.id !== target.id && before.sample.some((b) => b.id === s.id))
					.reduce((m, s) => Math.max(m, dist(before.sample, after.sample, s.id)), 0);
				if (others > 2) return actionNotOK(`a non-dragged node moved ${others.toFixed(1)} during the drag`);
				const dropped = after.sample.find((s) => s.id === target.id);
				if (dropped?.fx == null) return actionNotOK(`the dragged node "${target.id}" was not pinned on release`);
				const { x, y } = placed(dropped);
				return actionOKWithProducts({ id: target.id, x, y });
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
				await this.openSettings(page, SETTINGS_GROUP.layout);
				await this.view(page)
					.getByTestId(POLYMORPHIC_IDS.FLATTEN)
					.setChecked(toggle === FlattenSchema.enum.flatten);
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
				const on = toggle === GroupingSchema.enum.group;
				await this.openSettings(page, SETTINGS_GROUP.layout);
				await this.view(page).getByTestId(POLYMORPHIC_IDS.GROUPED).setChecked(on);
				await this.settle(page); // the toggle schedules the debounced relayout synchronously; settle waits for it
				if (on) await this.groupsDrawn(page);
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
				await this.openSettings(page, SETTINGS_GROUP.layout);
				await this.view(page).getByTestId(POLYMORPHIC_IDS.GROUPED).setChecked(true);
				await this.view(page).getByTestId(POLYMORPHIC_IDS.GROUP_BY).selectOption(axis);
				await this.settle(page); // the controls schedule the debounced relayout synchronously; settle waits for it
				await this.groupsDrawn(page);
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
				await this.selectView(page, view);
				if (!(await this.comesToHold(page, ({ el, arg }) => el.inspect()?.viewType === arg, view, STATE_MS)))
					return actionNotOK(`view-type did not switch to "${view}" (got "${(await this.state(page)).viewType}")`);
				await this.settle(page);
				return actionOK();
			},
		},
		graphPlacesGanttTasks: {
			// The gantt calendar places one task per subject carrying a start-kind time (an interval when it also carries an
			// end, a point milestone otherwise). Asserted from inspect().gantt: the same cached scale/targets the ruler and
			// bar placement read, so a passing count means the calendar laid out.
			gwta: `graph places at least {count: ${DOMAIN_NUMBER}} gantt tasks`,
			action: async ({ count }: { count: number }) => {
				const page = await this.page();
				await this.settle(page);
				const gantt = (await this.state(page)).gantt;
				if (!gantt) return actionNotOK("the calendar didn't lay out a gantt task");
				if (gantt.count < count) return actionNotOK(`only ${gantt.count} gantt task(s) placed (${gantt.from} → ${gantt.to}), expected at least ${count}`);
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
				// The lane reframe applies on the settle that has the placed bars; wait for the x-dominant aim rather than
				// reading once, so a settle observed a beat before the reframe applies does not read the prior framing.
				const aimed = await this.comesToHold(
					page,
					({ el }) => {
						const c = el.inspect()?.camera;
						return !!c && Math.abs(c.x) > Math.abs(c.z);
					},
					null,
					STATE_MS,
				);
				if (aimed) return actionOK();
				const cam = (await this.state(page)).camera;
				return actionNotOK(`camera is not on the lane-plane aim (x ${Math.round(cam?.x ?? 0)}, z ${Math.round(cam?.z ?? 0)})`);
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
				const { sample, sequence } = await this.state(page);
				const drawn = new Map(sample.map((n) => [n.id, n]));
				const wrong: string[] = [];
				for (const n of sample) if (Math.abs(placed(n).x) > 1) wrong.push(`${n.id} off the plane at x=${placed(n).x.toFixed(0)}`);
				// The placement the view computed IS where the node must be drawn; a gap means the layout never applied it.
				for (const p of sequence?.nodes ?? []) {
					const d = drawn.get(p.id);
					if (!d) continue;
					const at = placed(d);
					if (Math.abs(at.y - p.y) > 1 || Math.abs(at.z - p.z) > 1)
						wrong.push(`${p.id} drawn at (${at.y.toFixed(0)},${at.z.toFixed(0)}) but placed at (${p.y.toFixed(0)},${p.z.toFixed(0)})`);
				}
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
				await this.selectView(page, VIEW.sequence);
				await this.settle(page);
				const { sample, sequence } = await this.state(page);
				const typeOf = new Map(sample.map((n) => [n.id, n.type]));
				const actorTypes = [...new Set((sequence?.actors ?? []).map((a) => typeOf.get(a.id)).filter((t): t is string => !!t))];
				if (actorTypes.length === 0) return actionNotOK("the sequence didn't form an actor, so it can't reveal an actor type");
				await this.selectView(page, VIEW.force);
				const hide = await this.setFilterChips(CHIP_FACET.types, actorTypes, false);
				if (!hide.ok) return hide;
				await this.selectView(page, VIEW.sequence);
				await this.settle(page);
				const chips = await this.chipStates(page);
				const left = actorTypes.filter((t) => chips.find((c) => c.label.startsWith(t))?.checked !== true);
				return left.length === 0 ? actionOK() : actionNotOK(`the sequence left ${left.join(", ")} hidden, so its bars have nobody to draw`);
			},
		},
		graphFormsSequenceActors: {
			// The 3D sequence view derives one ACTOR per distinct participant (the merged role) from the graph: no hand-
			// applied labels. Assert at least {count} actors formed in inspect().sequence, the ground truth the lifelines
			// are drawn from (the lifeline pillars themselves are a 3D overlay, asserted via the lane placement below).
			gwta: `graph shows at least {count: ${DOMAIN_NUMBER}} sequence actors`,
			action: async ({ count }: { count: number }) => {
				const page = await this.page();
				await this.settle(page);
				const actors = (await this.state(page)).sequence?.actors ?? [];
				if (actors.length < count) return actionNotOK(`only ${actors.length} sequence actor(s) formed [${actors.map((a) => a.label).join(", ")}], expected at least ${count}`);
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
				const view = this.view(page);
				const shown = async (id: string) => (await view.getByTestId(id).count()) > 0 && (await view.getByTestId(id).first().isVisible());
				let closed = ""; // a control of the group opened last: opening another must take it off screen
				for (const group of [SETTINGS_GROUP.layout, SETTINGS_GROUP.scenes]) {
					const ids = SETTINGS_CONTROLS[group];
					await this.openSettings(page, group);
					const missing: string[] = [];
					for (const id of ids) if (!(await shown(id))) missing.push(id);
					if (missing.length) return actionNotOK(`option(s) not shown in the open ${group} group: ${missing.join(", ")}`);
					if (closed && (await shown(closed))) return actionNotOK(`the groups are not exclusive: ${closed} is still shown with ${group} open`);
					const actionsGone: string[] = [];
					for (const id of [POLYMORPHIC_IDS.FIT, POLYMORPHIC_IDS.COPY_GRAPH]) if (!(await shown(id))) actionsGone.push(id);
					if (actionsGone.length) return actionNotOK(`${actionsGone.join(", ")} left the head with ${group} open: an action is always reachable`);
					if (group === SETTINGS_GROUP.layout) {
						const views = await view
							.getByTestId(POLYMORPHIC_IDS.VIEW_TYPE)
							.locator("option")
							.evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
						if (views.join(",") !== VIEW_TYPES.join(",")) return actionNotOK(`the view control offers [${views.join(", ")}], not the full catalog [${VIEW_TYPES.join(", ")}]`);
					}
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
				await this.openSettings(page, SETTINGS_GROUP.layout);
				const view = this.view(page);
				const scene = (await view.getByTestId(POLYMORPHIC_IDS.GRAPH_CONTAINER).locator("a-scene").count()) > 0;
				const { viewType } = await this.state(page);
				if (viewType !== VIEW.sequence || !scene) return actionNotOK(`the 3D sequence scene is not shown (viewType=${viewType}, scene=${scene})`);
				const groupBy = (await view.getByTestId(POLYMORPHIC_IDS.GROUP_BY).count()) > 0;
				const grouped = (await view.getByTestId(POLYMORPHIC_IDS.GROUPED).count()) > 0;
				if (groupBy || grouped) return actionNotOK(`grouping controls still shown in sequence (group-by=${groupBy}, grouped=${grouped}): a lane view's lifelines ARE its grouping`);
				return actionOK();
			},
		},
		classBrowserShowsSchema: {
			// The type column embeds the site's class browser (ui.presents "schema"): the schema as a live graph whose
			// legend offers exactly the Class + Property toggles: no instance types, no per-type limit or solo tool.
			gwta: "class browser in the type column shows only the schema",
			action: async () => {
				const page = await this.page();
				const browser = page.locator(CLASS_BROWSER);
				const scene = page.locator(CLASS_BROWSER_SCENE);
				// The browser's first paints precede the schema scope (the reveal lands once the clusters are known), so wait for
				// the scoped state, only schema types drawn.
				const scoped = await comesToHold(
					scene,
					({ el, arg }: { el: ShuGraphScene; arg: string[] }) => {
						const types = [...el.nodeMap.values()].map((n) => n.type);
						return types.length > 0 && types.every((t) => arg.includes(t));
					},
					SCHEMA_TYPES,
					SETTLES_MS,
				);
				const nodeTypes = await scene.evaluate((el: ShuGraphScene) => [...new Set([...el.nodeMap.values()].map((n) => n.type))].sort());
				if (!scoped) return actionNotOK(`non-schema types drawn in the class browser: ${nodeTypes.filter((t) => !SCHEMA_TYPES.includes(t)).join(", ")}`);
				const filter = browser.locator(SHU_TAG.GRAPH_FILTER);
				const chips = (await filter.locator(FILTER_CHIP).allTextContents()).map((c) => c.trim().split(" ")[0]).sort();
				if (chips.join(",") !== SCHEMA_TYPES.join(",")) return actionNotOK(`legend should offer exactly ${SCHEMA_TYPES.join(" + ")}, got: ${chips.join(", ")}`);
				if ((await filter.getByTestId(FILTER_IDS.LIMIT_VALUE).count()) > 0) return actionNotOK("the schema legend must not carry the instance-data per-type limit");
				return actionOK();
			},
		},
		classBrowserIndependent: {
			// The browser holds an independent snapshot scope: narrowing the MAIN graph to one type (its own filter's
			// production path) must not change what the class browser shows.
			gwta: `class browser is unaffected when the main graph filters to type {typeName: ${DOMAIN_PERSISTED_TYPE}}`,
			action: async ({ typeName }: { typeName: string }) => {
				const page = await this.page();
				const scene = page.locator(CLASS_BROWSER_SCENE);
				// Both views boot from a fresh navigation; wait for each to hold its own nodes before measuring.
				await until(scene, ({ el }: { el: ShuGraphScene }) => el.nodeMap.size > 0, null);
				await this.waitForNodes(page, 1);
				const count = () => scene.evaluate((el: ShuGraphScene) => el.nodeMap.size);
				const before = await count();
				const filtered = await this.showOnlyType(page, typeName);
				if (!filtered.ok) return filtered;
				const after = await count();
				return after === before ? actionOK() : actionNotOK(`the main filter changed the class browser: ${before} → ${after} nodes`);
			},
		},
		classBrowserHighlights: {
			// The embedding column publishes its type as the shared selection: the type's Class node is highlighted within
			// the full schema: it and its incident neighbours (its properties, its superclass) stay lit, the rest dims.
			gwta: `class browser highlights {typeName: ${DOMAIN_PERSISTED_TYPE}} within the schema`,
			action: async ({ typeName }: { typeName: string }) => {
				const page = await this.page();
				const scene = page.locator(CLASS_BROWSER_SCENE);
				const highlighted = await comesToHold(
					scene,
					({ el, arg }: { el: ShuGraphScene; arg: { id: string; lit: number; dim: number } }) => {
						if (!el.nodeMap.has(arg.id)) return false;
						const i = el.inspect();
						return i.focus.selected === arg.id && i.sample.some((n) => (n.opacity ?? 1) < arg.dim) && i.sample.some((n) => (n.opacity ?? 1) > arg.lit);
					},
					{ id: typeName, lit: LIT_OPACITY, dim: DIM_OPACITY },
					ROUND_TRIP_MS,
				);
				if (highlighted) return actionOK();
				const i = await scene.evaluate((el: ShuGraphScene, t) => ({ has: el.nodeMap.has(t), nodes: el.nodeMap.size, state: el.inspect() }), typeName);
				const dim = i.state.sample.filter((n) => isDim(n.opacity)).length;
				const lit = i.state.sample.filter((n) => isLit(n.opacity)).length;
				return actionNotOK(
					`${typeName} is not highlighted within the schema (selected=${i.state.focus.selected}, dim=${dim}, lit=${lit}, has=${i.has}, nodes=${i.nodes}, sampled=${i.state.sample.length}, engineMode=${i.state.engineMode}, paused=${i.state.render.paused})`,
				);
			},
		},
		sequenceHasMessages: {
			// The sequence's messages are the cross-participant edges, time-ordered. Assert at least {count} messages
			// formed in inspect().sequence: the ground truth the message arrows between lifelines are drawn from.
			gwta: `graph shows at least {count: ${DOMAIN_NUMBER}} sequence messages`,
			action: async ({ count }: { count: number }) => {
				const page = await this.page();
				await this.settle(page);
				const messages = (await this.state(page)).sequence?.messages ?? [];
				if (messages.length < count)
					return actionNotOK(`only ${messages.length} sequence message(s) formed [${messages.map((m) => `${m.from}→${m.to}:${m.label}`).join("; ")}], expected at least ${count}`);
				return actionOK();
			},
		},
		saveGraphScene: {
			// Save the way the graph is currently set up under a name, through the production control (the settings' name
			// field + save button), the same path a reader takes, so the write goes through the app's own step RPC.
			gwta: `save graph scene as {name: ${DOMAIN_SCENE_NAME}}`,
			productsDomain: DOMAIN_GRAPH_SCENE,
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				await this.openSettings(page, SETTINGS_GROUP.scenes);
				const view = this.view(page);
				await view.getByTestId(POLYMORPHIC_IDS.SCENE_NAME).fill(name);
				await view.getByTestId(POLYMORPHIC_IDS.SCENE_SAVE).click();
				// The save is a round trip; the scene appears in the picker when it lands.
				await attached(this.sceneOption(page, name), ROUND_TRIP_MS);
				return actionOKWithProducts({ name, setup: await this.captureGraphScene(page) });
			},
		},
		applyGraphScene: {
			// Return the graph to a saved scene through the production control (the settings' scene picker).
			gwta: `apply graph scene {name: ${DOMAIN_SCENE_NAME}}`,
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				await this.openSettings(page, SETTINGS_GROUP.scenes);
				if ((await this.sceneOption(page, name).count()) === 0) return actionNotOK(`the view doesn't offer a scene saved as "${name}"`);
				await this.view(page).getByTestId(POLYMORPHIC_IDS.SCENE_PICKER).selectOption(name);
				// Reading the scene back is a round trip; the view says which scene it is showing once the return has landed.
				await this.untilGraph(page, ({ el, arg }) => el.getAttribute("data-scene") === arg, name, ROUND_TRIP_MS);
				await this.settle(page);
				return actionOK();
			},
		},
		graphOffersScene: {
			// The scene is offered without reloading the page: a scene saved anywhere reaches this view as live data.
			gwta: `graph offers scene {name: ${DOMAIN_SCENE_NAME}}`,
			action: async ({ name }: { name: string }) => {
				const page = await this.page();
				await this.openSettings(page, SETTINGS_GROUP.scenes);
				await attached(this.sceneOption(page, name), SETTLES_MS);
				return actionOK();
			},
		},
		graphSceneMatches: {
			// What the view shows now, compared option by option with what it showed when the scene was saved. The
			// comparison is against the view's OWN record (captureScene), and the values under comparison travelled through
			// the store and back, so this proves the return restored every option rather than that a control changed.
			gwta: `graph scene matches {scene: ${DOMAIN_GRAPH_SCENE}}`,
			action: async ({ scene }: { scene: TGraphScene }) => {
				const { name, setup: saved } = scene;
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
				await this.revealSchema(page, true);
				return actionOK();
			},
		},
		returnToLiveData: {
			gwta: "return the graph to live data",
			action: async () => {
				const page = await this.page();
				await this.revealSchema(page, false);
				return actionOK();
			},
		},
		timeCursorHidesFuture: {
			// Scrub the shared time cursor to a cutoff in the middle of the nodes' ages: nodes recorded after it vanish;
			// clearing the cursor (null = live) restores them. The graph reacts to the same global cursor the timeline drives.
			gwta: "scrubbing the time cursor hides newer nodes and restores on clear",
			action: async () => {
				const page = await this.page();
				await this.settle(page);
				const { nodes: before, sample } = await this.state(page);
				const times = sample
					.map((s) => s.t)
					.filter((t): t is number => t != null)
					.sort((a, b) => a - b);
				if (times.length < 3) return actionNotOK(`not enough timed nodes to scrub (${times.length})`);
				const cutoff = times[Math.floor(times.length / 2)]; // median age, hides the newer half
				await this.setTimeCursor(page, cutoff);
				// The time-filter repaint is debounced, so wait for the transition rather than reading once.
				const hid = await this.comesToHold(page, ({ el, arg }) => (el.inspect()?.nodes ?? arg) < arg, before, STATE_MS);
				const hidden = (await this.state(page)).nodes;
				await this.setTimeCursor(page, null);
				const restored = await this.comesToHold(page, ({ el, arg }) => (el.inspect()?.nodes ?? 0) >= arg, before, STATE_MS);
				if (!hid) return actionNotOK(`scrubbing the cursor did not hide newer nodes (${before} shown → ${hidden})`);
				if (!restored) return actionNotOK(`clearing the cursor did not restore nodes (${before} → ${(await this.state(page)).nodes})`);
				return actionOK();
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
				const L = (await this.state(page)).layered;
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
				const span = (sel: (n: { x: number; y: number; z: number }) => number): number => range(L.nodes.map(sel));
				const flowExt = span(flowR);
				const zExt = span((n) => n.z);
				if (flowExt < zExt)
					return actionNotOK(
						`the rank axis spans only ${flowExt.toFixed(0)} but the time-depth spans ${zExt.toFixed(0)}: the hierarchy is dwarfed by depth and won't read as a flow`,
					);
				return actionOK();
			},
		},
		saveGraphStill: {
			// The graph as a self-contained SVG, saved as an artifact the way a screenshot is: it rides the artifact
			// stream into the run's report, and stands alone as an image. The markup comes from the view's still():
			// the SAME placed nodes the WebGL renderer displays, drawn by the SVG renderer, so a still in a report
			// always matches what the run's reader saw.
			gwta: "save a graph still",
			productsDomain: DOMAIN_GRAPH_STILL,
			action: async (_: unknown, featureStep: TFeatureStep) => {
				const page = await this.page();
				await this.settle(page);
				const { svg, sceneNodes } = await this.view(page).evaluate((view: ShuPolymorphicGraphView) => ({ svg: view.still(), sceneNodes: view.nodeMap?.size ?? 0 }));
				if (!svg.startsWith("<svg")) return actionNotOK("the view didn't produce a still: is the graph view mounted?");
				const nodes = (svg.match(/<circle /g) ?? []).length;
				if (nodes !== sceneNodes) return actionNotOK(`the still drew ${nodes} node(s) but the scene holds ${sceneNodes}: a still must show exactly what is on screen`);
				const wp = controlledBrowser(this);
				if (!wp.storage) return actionNotOK("save a graph still: the world doesn't hold a storage stepper");
				const saved = await saveImageArtifact(this.getWorld(), wp.storage, featureStep, `graph-still-${featureStep.seqPath.join(".")}.svg`, svg, "image/svg+xml");
				return actionOKWithProducts({ path: saved.baseRelativePath, nodes });
			},
		},
		toggleGraphReading: {
			// The head's reading toggle: it holds the accessible document open for everyone, not only for a keyboard
			// reader who tabs into it.
			gwta: "toggle graph reading",
			action: async () => {
				await (await this.page()).getByTestId(POLYMORPHIC_IDS.READ).click();
				return actionOK();
			},
		},
		graphReadingShown: {
			// Shown means SHOWN, not merely present: the region is clipped to a pixel until it is opened, so this reads
			// its rendered size rather than its markup. It reads the painted background too: the guide lies over the
			// graph, so it is translucent, which no jsdom test can tell from opaque.
			gwta: "graph reading is on screen",
			action: async () => {
				const region = (await this.page()).getByTestId(POLYMORPHIC_IDS.A11Y);
				if ((await region.count()) === 0) return actionNotOK(NO_READING);
				const seen = await region.evaluate((el) => {
					const r = el.getBoundingClientRect();
					const style = getComputedStyle(el);
					const list = el.querySelector("ol");
					return {
						w: r.width,
						h: r.height,
						background: style.backgroundColor,
						fontSize: Number.parseFloat(style.fontSize),
						markerRoom: list ? Number.parseFloat(getComputedStyle(list).paddingLeft) : 0,
					};
				});
				if (!(seen.w > 20 && seen.h > 20)) return actionNotOK(`the reading is clipped away (${seen.w.toFixed(0)}×${seen.h.toFixed(0)})`);
				const alpha = paintedAlpha(seen.background);
				if (alpha >= 1) return actionNotOK(`the reading is painted opaque (${seen.background}), so the graph under it is hidden`);
				// A line's number is drawn in the list's left padding: too little, and it runs back over the region's own
				// edge. Two characters are what a numbered reading of any length needs.
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
				const region = this.view(page).getByTestId(POLYMORPHIC_IDS.A11Y);
				if ((await region.count()) === 0) return actionNotOK(NO_READING);
				const res = await region.evaluate((el, attr) => {
					const entryIds = [...el.querySelectorAll(`ol > li > [${attr}]`)].map((b) => b.getAttribute(attr));
					// An edge line's target is a way to that node, so every one of them must name a node that was drawn:
					// a reading that offers a way to something not there leads a reader who cannot see the picture nowhere.
					const drawn = new Set(entryIds);
					const waysNowhere = [...el.querySelectorAll(`ol > li ul [${attr}]`)].filter((b) => !drawn.has(b.getAttribute(attr))).length;
					return { entries: entryIds.length, waysNowhere, status: el.querySelector('[role="status"]')?.textContent ?? "" };
				}, NODE_ID_ATTR);
				const { nodes } = await this.state(page);
				if (res.entries !== nodes) return actionNotOK(`the accessible document lists ${res.entries} entries for ${nodes} drawn nodes`);
				if (res.waysNowhere > 0) return actionNotOK(`${res.waysNowhere} of the document's edge lines offer a way to a node it doesn't list`);
				if (!res.status.includes(`${nodes} nodes`)) return actionNotOK(`the status line does not announce the node count: "${res.status}"`);
				return actionOK();
			},
		},
		graphDepthEncodesTime: {
			gwta: "graph depth encodes time",
			action: async () => {
				// z is the time axis: older nodes sit at a different depth, so across a time-spread fixture z must vary.
				const timed = (await this.state(await this.page())).sample.filter((n) => n.t != null);
				if (timed.length < 2) return actionNotOK("not enough timed nodes to judge the depth axis");
				const zRange = range(timed.map((n) => placed(n).z));
				return zRange > 1 ? actionOK() : actionNotOK(`node depth (z) does not vary with time (z range ${zRange.toFixed(2)})`);
			},
		},
		placeGraphDepthBy: {
			// Switch what the depth (z) axis encodes via the production select (the view-settings z basis), then wait for
			// the relayout. One step for every basis so a feature can flip time ↔ connections and prove the depth re-places.
			gwta: `place graph depth by {basis: ${DOMAIN_GRAPH_ZBASIS}}`,
			action: async ({ basis }: { basis: string }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				await this.openSettings(page, SETTINGS_GROUP.layout);
				await this.view(page)
					.getByTestId(POLYMORPHIC_IDS.Z_BASIS)
					.selectOption(ZBASIS_VALUE[basis as keyof typeof ZBASIS_VALUE]);
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
				await this.openSettings(page, SETTINGS_GROUP.layout);
				const labelAsDepth = this.view(page).getByTestId(POLYMORPHIC_IDS.LABEL_AS_Z);
				const chips = async (): Promise<Record<string, string | null>> => {
					await this.settle(page);
					return Object.fromEntries((await this.state(page)).sample.map((n) => [n.id, n.chip]));
				};
				await labelAsDepth.setChecked(false);
				const named = await chips();
				if (Object.keys(named).length === 0) return actionNotOK("the graph doesn't draw a chip to re-label");
				await labelAsDepth.setChecked(true);
				const byDepth = await chips();
				const changed = Object.keys(named).filter((id) => byDepth[id] !== named[id]);
				if (changed.length === 0) return actionNotOK(`turning label-as-depth on didn't change a chip (still "${Object.values(named)[0]}"): it took another change to redraw`);
				await labelAsDepth.setChecked(false);
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
				const byDegree = (await this.state(await this.page())).sample
					.flatMap((n) => (n.degree == null ? [] : [{ degree: n.degree, z: placed(n).z }]))
					.sort((a, b) => a.degree - b.degree);
				if (byDegree.length < 2) return actionNotOK("not enough nodes with a degree to judge the depth axis");
				const low = byDegree[0];
				const high = byDegree[byDegree.length - 1];
				if (high.degree === low.degree) return actionNotOK("every node has the same degree: the fixture can't exercise connection depth");
				return high.z < low.z
					? actionOK()
					: actionNotOK(`more connections should sit shallower: degree ${high.degree} at z=${high.z.toFixed(1)} vs degree ${low.degree} at z=${low.z.toFixed(1)}`);
			},
		},
		focusedEdgesBright: {
			gwta: "focused edges are brighter than the rest",
			action: async () => {
				const opacities = (await this.state(await this.page())).edges.flatMap((e) => (e.lineOpacity == null ? [] : [e.lineOpacity]));
				if (opacities.length < 2) return actionNotOK("not enough edges to compare");
				const bright = opacities.filter(isLit).length;
				const dim = opacities.filter(isDim).length;
				return bright > 0 && dim > 0 ? actionOK() : actionNotOK(`edges not split into bright/dim under focus (bright ${bright}, dim ${dim}, of ${opacities.length})`);
			},
		},
		graphNodePinned: {
			// A node the user dragged holds the place they dropped it in, through a live data repaint: a streamed arrival
			// must neither unpin it nor put it back where the layout would have had it.
			gwta: `graph node {dropped: ${DOMAIN_GRAPH_DROP}} stays pinned`,
			action: async ({ dropped }: { dropped: z.infer<typeof GraphDropSchema> }) => {
				const page = await this.page();
				const id = await this.nodeId(page, dropped.id);
				const now = (await this.state(page)).sample.find((s) => s.id === id);
				if (now?.fx == null) return actionNotOK(`graph node "${id}" is not pinned any more (fx=${now?.fx ?? null}): the repaint unpinned it`);
				const at = placed(now);
				const moved = Math.hypot(at.x - dropped.x, at.y - dropped.y);
				return moved <= 1
					? actionOK()
					: actionNotOK(
							`graph node "${id}" moved ${moved.toFixed(1)} from where it was dropped (${dropped.x.toFixed(1)}, ${dropped.y.toFixed(1)}) to (${at.x.toFixed(1)}, ${at.y.toFixed(1)})`,
						);
			},
		},
		graphHoldsDistanceSince: {
			// Following moves what the camera LOOKS AT, never how close it is. The apparent size of what it looks at, so
			// whether that node's label is readable, is set by the camera's distance to its target, which must therefore
			// be the same after following to another node as before. (inspect's worldPerPx is measured at the ORIGIN, so
			// it moves whenever the target moves in depth even though nothing zoomed; the distance is the reliable signal.)
			gwta: `graph holds its distance to what it looks at since {before: ${DOMAIN_GRAPH_SNAPSHOT}}`,
			action: async ({ before }: { before: Snapshot }) => {
				const after = await this.framing(await this.page());
				const span = (s: TFraming): number | null =>
					s.camera?.target ? Math.hypot(s.camera.x - s.camera.target.x, s.camera.y - s.camera.target.y, s.camera.z - s.camera.target.z) : null;
				const was = span(before);
				const now = span(after);
				if (was === null || now === null) return actionNotOK(`the camera doesn't hold an aim to compare (snapshot ${was}, live ${now})`);
				const drift = Math.abs(now - was) / was;
				return drift <= 0.01
					? actionOK()
					: actionNotOK(`the camera's distance to what it looks at moved ${percent(drift, 1)} since the snapshot: a label readable then is not readable now`);
			},
		},
		graphNodePlaced: {
			// A streamed-in node lands in the layout (not collapsed at the origin), proves a live arrival is laid out, not dropped.
			gwta: `graph node {match: ${DOMAIN_GRAPH_NODE}} is placed in the layout`,
			action: async ({ match: { id: match } }: { match: TGraphNode }) => {
				const page = await this.page();
				const id = await this.nodeId(page, match);
				const n = (await this.state(page)).sample.find((s) => s.id === id);
				if (!n) return actionNotOK(`graph node "${id}" not in the layout sample`);
				if (n.x === undefined || n.y === undefined) return actionNotOK(`graph node "${id}" isn't placed: the streamed node was not laid out`);
				return Math.hypot(n.x, n.y) > 1 ? actionOK() : actionNotOK(`graph node "${id}" sits at the origin: the streamed node was not laid out`);
			},
		},
		previewGraphType: {
			// Hovering a type in the filter legend previews it: that type stays full and every other type dims, even over a node focus.
			gwta: `preview graph type {type: ${DOMAIN_PERSISTED_TYPE}}`,
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
			gwta: `only graph type {type: ${DOMAIN_PERSISTED_TYPE}} is shown full`,
			action: async ({ type }: { type: string }) => {
				const { sample } = await this.state(await this.page());
				const dimOfType = sample.filter((n) => n.type === type && !isLit(n.opacity)).length;
				const litOffType = sample.filter((n) => n.type !== type && isLit(n.opacity)).length;
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
				const before = await this.state(page);
				await page.keyboard.down(CAMERA_MODIFIER);
				await page.mouse.move(target.x, target.y, { steps: 2 });
				await page.mouse.down();
				const pending = (await this.state(page)).dragPending;
				await page.mouse.move(target.x + 140, target.y + 20, { steps: 10 }); // a camera-orbit drag
				await page.mouse.up();
				await page.keyboard.up(CAMERA_MODIFIER);
				await this.settle(page);
				const after = await this.state(page);
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
			gwta: `magnifying the {node: ${DOMAIN_GRAPH_NODE}} node does not widen where it can be grabbed`,
			action: async ({ node }: { node: TGraphNode }) => {
				const page = await this.page();
				const id = await this.nodeId(page, node.id);
				// The head-on aim, not fit: fit keeps whatever orbit earlier scenarios left, and an oblique aim can put
				// another chip in front of the probed one along the ray. The span probe needs the deterministic frame.
				await this.headOn(page);
				await this.hover(page, null);
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
				await this.openNode(page, id); // select it → it becomes the focus and magnifies (a hover is ignored while another node is selected)
				await this.untilGraph(page, ({ el, arg }) => (el.inspect()?.sample.find((s) => s.id === arg)?.k ?? 1) > 1, id, STATE_MS);
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
			gwta: `profile graph render at {perTypeLimit: ${DOMAIN_NUMBER}} nodes per type`,
			action: async ({ perTypeLimit: limit }: { perTypeLimit: number }) => {
				const page = await this.page();
				await this.waitForNodes(page, 1);
				const slider = (await this.filterControls(page)).getByTestId(FILTER_IDS.LIMIT);
				if ((await slider.count()) === 0) return actionNotOK("the graph filter doesn't hold a per-type limit slider to profile");
				await this.view(page).evaluate((view: ShuPolymorphicGraphView) => view.resetProfile()); // measure only the re-render this limit change triggers
				await slider.fill(String(limit)); // drive the real slider: input tracks the label, change (release) dispatches the refetch
				await this.settleScopedRefetch(page);
				const p = (await this.state(page)).profile;
				const forceMs = Math.max(0, p.setMs - p.labelsMs);
				this.getWorld().eventLogger.info(
					`polymorphic render profile @ perTypeLimit ${limit}: ${p.nodes} nodes over ${p.repaints} repaint(s), compute ${p.computeMs.toFixed(1)}ms, force-warmup ${forceMs.toFixed(1)}ms, label-textures ${p.labelsMs.toFixed(1)}ms (graphData set ${p.setMs.toFixed(1)}ms)`,
					{ "haibun.polymorphic.profile": JSON.stringify({ ...p, forceMs }) },
				);
				return p.repaints > 0
					? actionOK()
					: actionNotOK(`limit ${limit} didn't re-render the graph (0 repaints): it didn't change the visible set, so the profile doesn't have a repaint to read`);
			},
		},
	};

	/** Move the real pointer onto a pixel that picks node `id` AND that a real pointer reaches, or null where there is none.
	 * Probes with the side-effect-free pickAt: a real press on a MISS would orbit the camera and walk the node off-screen,
	 * defeating the next probe. The chip sits right of and a little below its anchor, and an overlay (the actions bar) can
	 * cover part of it, so accept only a pixel the view picks AND whose elementFromPoint is inside the view. */
	private async aimAtNode(page: Page, id: string): Promise<{ x: number; y: number } | null> {
		for (const dy of [0, 8, -8, 16, -16]) {
			for (const dx of [12, 6, 0, 24, 36, -8, -20]) {
				const c = await this.projectNode(page, id, dx);
				const p = { x: c.x, y: c.y + dy };
				if ((await this.pickAt(page, p.x, p.y)) !== id) continue;
				const reachable = await this.view(page).evaluate((view, at) => view.contains(document.elementFromPoint(at.x, at.y)), p);
				if (!reachable) continue;
				await page.mouse.move(p.x, p.y, { steps: 2 });
				return p;
			}
		}
		return null;
	}

	/** Press the node with the real pointer and leave it DOWN (the caller drags then ups), or null with the pointer up.
	 *  The single press path drag + ctrl + magnify tests share. */
	private async pressOnNode(page: Page, id: string): Promise<{ x: number; y: number } | null> {
		const p = await this.aimAtNode(page, id);
		if (p) await page.mouse.down();
		return p;
	}

	/** Whether the node becomes the view's selected subject within five seconds. A selection passes through the app first. */
	private becomesSelected(page: Page, id: string): Promise<boolean> {
		return this.comesToHold(page, ({ el, arg }) => el.inspect()?.focus.selected === arg, id, STATE_MS);
	}

	/** Wait for a node's PROJECTED screen position to stop moving. A fit/reframe animates over several frames AFTER the
	 * engine freezes, so settle() alone leaves the node mid-flight; poll its projection until two reads agree to ~1px. */
	private async settleNodeProjection(page: Page, id: string): Promise<void> {
		await this.pollUntilStable(
			page,
			40,
			40,
			() => this.view(page).evaluate((view: ShuPolymorphicGraphView, nid) => view.projectNodeToScreen(nid), id),
			(now, prev) => !!now && !!prev && Math.abs(now.x - prev.x) < 1 && Math.abs(now.y - prev.y) < 1,
		);
	}

	/** Frame the graph, then press the first node the view reports DRAGGABLE (an un-occluded pixel), returning it + the
	 *  pressed pixel with the pointer left DOWN on it. On failure `target` is null and `diag` says why: the aim, the
	 *  pick target's own state, and whether the camera frames the graph at all. */
	private async pressFirstDraggable(page: Page): Promise<{ target: { id: string; x: number; y: number } | null; diag: string }> {
		// Settle BEFORE framing: an owed repaint re-places every node (a depth-basis switch re-derives z), so a fit taken
		// first frames a layout that is about to move out of it, and the view never re-frames itself, by design.
		await this.settle(page);
		await this.headOn(page); // the head-on frame: deterministic aim + scale before pixel-aiming (fit keeps an earlier scenario's orbit)
		await this.settle(page);
		const { sample } = await this.state(page);
		if (sample.length === 0) return { target: null, diag: "the layout sample is empty: the graph doesn't draw a node" };
		await this.settleNodeProjection(page, sample[0].id); // the fit reframe animates AFTER the engine freezes, wait the projection still
		for (const s of sample) {
			const at = await this.pressOnNode(page, s.id); // leaves the pointer DOWN on the first un-occluded node
			if (at) return { target: { id: s.id, x: at.x, y: at.y }, diag: "" };
		}
		// A node wasn't pickable, and only NOW (the failure path) reconstruct why, so a passing call doesn't pay for it. A miss
		// is either aim (the centre is off-canvas) or object (a missing pick target, or one the raycast skips), and the two
		// want opposite fixes, so the report names which: the pixel, what picks there, and the pick target's own state.
		return { target: null, diag: `${sample.length} nodes, and a pick at each one's centre missed ${await this.unpickableReport(page, sample)}` };
	}

	/** A report of the canvas, the camera, and for each sampled node its centre pixel and what that pixel picks. */
	private async unpickableReport(page: Page, sample: TSampled[]): Promise<string> {
		const misses: string[] = [];
		for (const s of sample.slice(0, 8)) misses.push(await this.missReport(page, s.id));
		const box = await this.view(page).locator("canvas").first().boundingBox();
		const { onScreen, camera } = await this.state(page);
		const frustum = `onScreen=${onScreen ? `${onScreen.onScreen}/${onScreen.total} span=${onScreen.span.toFixed(2)}` : "null"} camera=${camera ? `${camera.x.toFixed(0)},${camera.y.toFixed(0)},${camera.z.toFixed(0)} fov=${camera.fov ?? "?"}` : "null"}`;
		return `(canvas ${box ? `${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}` : NO_ELEMENT}, ${frustum}): ${misses.join("  ")}`;
	}

	/** A report for one node: its projected centre pixel, the node the raycast picks there, the topmost element at that
	 *  pixel, and the state of its pick target. A panel over the canvas is the topmost element where it covers the node. */
	private async missReport(page: Page, id: string): Promise<string> {
		const c = await this.view(page).evaluate((view: ShuPolymorphicGraphView, nid) => view.projectNodeToScreen(nid), id);
		if (!c) return `${id}→offscreen`;
		const over = await page.evaluate((at) => document.elementFromPoint(at.x, at.y)?.tagName.toLowerCase(), c);
		return `${id}@(${c.x.toFixed(0)},${c.y.toFixed(0)})→${(await this.pickAt(page, c.x, c.y)) ?? NO_ELEMENT} under ${over ?? NO_ELEMENT} ${await this.pickTargetState(page, id)}`;
	}

	/** What the raycast has to hit for a node: whether it has a sprite/pick target at all, whether that target is visible
	 *  (an invisible one is skipped), and where it sits versus the node the projection aimed at. */
	private pickTargetState(page: Page, id: string): Promise<string> {
		return this.view(page).evaluate((view: ShuPolymorphicGraphView, nid) => {
			const n = view.nodeMap?.get(nid) as
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

	/** The main graph's filter. */
	private filter(page: Page): Locator {
		return this.view(page).locator(SHU_TAG.GRAPH_FILTER);
	}

	/** The main graph's filter with its controls on screen: a person opens the filters group before using one. */
	private async filterControls(page: Page): Promise<Locator> {
		await this.openSettings(page, SETTINGS_GROUP.filters);
		return this.filter(page);
	}

	/** Show only one type through the filter's own setter, and wait for the refetch to land. */
	private async showOnlyType(page: Page, type: string): Promise<TActionResult> {
		if ((await this.filter(page).count()) === 0) return actionNotOK(NO_FILTER);
		await this.filter(page).evaluate((filter: ShuGraphFilter, t) => filter.setVisibleTypes([t]), type);
		await this.settleScopedRefetch(page);
		return actionOK();
	}

	/** Show or hide a set of chips through the filter's own public setters: one path for the types and the properties. */
	private async setFilterChips(facet: TChipFacet, list: string[], visible: boolean): Promise<TActionResult> {
		const page = await this.page();
		await this.waitForNodes(page, 1);
		if ((await this.filter(page).count()) === 0) return actionNotOK(NO_FILTER);
		await this.filter(page).evaluate((filter: ShuGraphFilter, a) => (a.types ? filter.setTypeVisibility(a.list, a.visible) : filter.setPredicateVisibility(a.list, a.visible)), {
			types: facet === CHIP_FACET.types,
			list,
			visible,
		});
		await this.settleScopedRefetch(page);
		return actionOK();
	}

	/** The view's own record of how it is set up: the same reading a scene saves. */
	private captureGraphScene(page: Page): Promise<Record<string, Record<string, unknown>>> {
		return this.view(page).evaluate((view: ShuPolymorphicGraphView) => view.captureScene() as Record<string, Record<string, unknown>>);
	}

	/** The scene picker's option for a scene name. */
	private sceneOption(page: Page, name: string): Locator {
		return this.view(page)
			.getByTestId(POLYMORPHIC_IDS.SCENE_PICKER)
			.locator(`option[value=${JSON.stringify(name)}]`);
	}

	/** Open one settings group's row via its head icon (the groups are exclusive, opening one closes another), then
	 *  wait for a control of that group to attach: what a reader can reach and what a step can drive are the same. */
	private async openSettings(page: Page, group: TSettingsGroup): Promise<void> {
		const view = this.view(page);
		const probeId = SETTINGS_CONTROLS[group][0]; // the filters group doesn't have a control of its own: its icon's pressed state is the answer
		if (probeId && (await view.getByTestId(probeId).count()) > 0) return;
		const icon = view.getByTestId(POLYMORPHIC_IDS.SETTINGS[group]);
		if (!probeId && (await icon.getAttribute(ARIA_PRESSED)) === PRESSED) return;
		await icon.click();
		if (probeId) await attached(view.getByTestId(probeId));
	}

	/** Drive the production view control to `value`, exactly as a person choosing it does. */
	private async selectView(page: Page, value: string): Promise<void> {
		await this.openSettings(page, SETTINGS_GROUP.layout);
		await this.view(page).getByTestId(POLYMORPHIC_IDS.VIEW_TYPE).selectOption(value);
	}

	/** Fire the filter legend's type-preview (or clear it with null) at the view: the same event a legend hover sends. */
	private async dispatchPreview(page: Page, type: string | null): Promise<void> {
		await this.view(page).evaluate((view, t) => view.dispatchEvent(new CustomEvent("graph-type-preview", { detail: { type: t }, bubbles: true })), type);
		await this.settle(page); // the focus/dim repaint is debounced
	}

	/** Which node a press at these client pixels would pick, through the view's pickAt(), with no pointer side effects. */
	private pickAt(page: Page, x: number, y: number): Promise<string | null> {
		return this.view(page).evaluate((view: ShuPolymorphicGraphView, at) => view.pickAt(at.x, at.y), { x, y });
	}
}

/** Where the layout placed a sampled node. The engine places every node before the layout settles, which is when a
 *  step reads positions, so an unplaced node is refused. */
function placed(n: TSampled): { x: number; y: number; z: number } {
	if (n.x === undefined || n.y === undefined || n.z === undefined) throw new Error(`graph node "${n.id}" isn't placed`);
	return { x: n.x, y: n.y, z: n.z };
}

/** How far two centred spans overlap along one axis, 0 where they don't. */
const overlap1D = (c1: number, s1: number, c2: number, s2: number): number => Math.max(0, Math.min(c1 + s1 / 2, c2 + s2 / 2) - Math.max(c1 - s1 / 2, c2 - s2 / 2));

/** The pairs of group boxes that overlap on both x and y, each named by its two titles. */
function overlappingPairs(boxes: TEnclosure[]): string[] {
	return boxes.flatMap((a, i) =>
		boxes.slice(i + 1).flatMap((b) => (overlap1D(a.x, a.sx, b.x, b.sx) > 0 && overlap1D(a.y, a.sy, b.y, b.sy) > 0 ? [`"${a.title}" and "${b.title}"`] : [])),
	);
}

/** The area of the boxes' bounding box over their summed area: 1 where they tile it, and larger as they scatter. */
function packingOf(boxes: TEnclosure[]): number {
	const width = Math.max(...boxes.map((b) => b.x + b.sx / 2)) - Math.min(...boxes.map((b) => b.x - b.sx / 2));
	const height = Math.max(...boxes.map((b) => b.y + b.sy / 2)) - Math.min(...boxes.map((b) => b.y - b.sy / 2));
	return (width * height) / boxes.reduce((sum, b) => sum + b.sx * b.sy, 0);
}

/** The graph's framing and where it placed each node, read from what it draws. */
function framingOf({ camera, viewport, sample }: TGraphState): TFraming {
	return { camera, viewport, pos: Object.fromEntries(sample.map((n) => [n.id, placed(n)])) };
}
const range = (xs: number[]): number => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
/** How far a node moved between two samples, in the view's plane. */
const dist = (a: TSampled[], b: TSampled[], id: string): number => {
	const p = a.find((s) => s.id === id);
	const q = b.find((s) => s.id === id);
	if (!p || !q) throw new Error(`graph node "${id}" isn't in both samples`);
	return Math.hypot(placed(q).x - placed(p).x, placed(q).y - placed(p).y);
};
