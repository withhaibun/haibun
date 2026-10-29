/// <reference path="./three-controls.d.ts" />
import "aframe";
import ForceGraphVR from "3d-force-graph-vr";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "../../components/shu-element.js";
import { SITE_KEY, type GraphModel } from "../../../domains/graph-model.js";
import { omittedOf } from "../../../derivations/graph-model.js";
import { latestStepLabel, readsEveryStatement, statedAboutFirst } from "../derivations/summary.js";
import { DEFAULT_PER_TYPE_LIMIT } from "../domains/snapshot.js";
import { dispatchSubjectEvent } from "../../controllers/subject-controller.js";
import { SCOPE, entryOf } from "../../domains/current-subject.js";
import { formatInstant, readerZone } from "../../derivations/time-format.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import type { TGraphEnginePacing, TGraphFrameLoop, TGraphFrameTime, TGraphRenderer, TSceneCamera } from "../ports.js";
import type { TAframeScene } from "../adapters/frame-loop.js";
import { configureLabelFonts, makeTroikaChip, makeTroikaText, spriteVisual, type ChipThree } from "./troika-label.js";
import { FULL_BURN, GLOW_RAMP, BREATH_MS } from "../derivations/highlight.js";
import { typeAvatar } from "../derivations/type-avatar.js";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { PAGE_TERMS, type TCounted } from "@haibun/core/lib/domains/hypermedia.js";
import { isSubPropertyOf } from "@haibun/core/lib/domains/resources.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { type GroupKeyMode, groupKeyOf, groupTitles } from "../derivations/grouping.js";
import { linkKey, type KindTiers, type TGraphPreview } from "../derivations/focus-policy.js";
import { withAxioms, type TAxiomOverlay } from "../derivations/axiom-overlay.js";
import { quadsToGanttModel, cascadeReschedule } from "../derivations/gantt-model.js";
import { availablePaints } from "../derivations/paint-select.js";
import { ganttBarSpan, ganttExtentOf, type GanttTarget } from "../derivations/gantt-layout.js";
import type { Adornment } from "../derivations/graph-layout.js";
import { CameraController } from "../controllers/camera-controller.js";
import { PickController, type TPickThree } from "../controllers/pick-controller.js";
import { GanttOverlay, type GanttThree } from "./gantt-overlay.js";
import { sceneDataHash, visibleGraph, type TSceneData } from "../derivations/scene-data.js";
import { SHU_ATTR, SHU_EVENT, SHU_TAG } from "../../../domains/elements.js";
import { defineElement } from "../../controllers/element-controller.js";
import { RenderContext } from "./render-context.js";
import { SceneController } from "../controllers/scene-controller.js";
import { type RenderType, type TViewForces, buildRenderTypeRegistry } from "./render-type.js";
import { type ViewType, FRAME, VIEW, isLaneView, viewChangeRebuildsNodes } from "../domains/views.js";
import { SCHEMA_TERM, holdsSchema, isSchemaType, schemaHoverText, schemaTermOf, schemaTypes } from "../../../derivations/ontology-projection.js";
import { actorTypesFor, fromActorEdgeLabels, relationOfPredicate, roleEdgeLabels, roleNounFor, toActorEdgeLabels, validTimeFieldOf } from "../../controllers/catalog-controller.js";
import { compositeRenderer, threeRenderer } from "./renderer.js";
import { A11yRenderer } from "./a11y-renderer.js";
import type { TFenceGl } from "../adapters/frame-time.js";
import { ObserverController } from "../../controllers/observer-controller.js";
import { pageAddress } from "../../controllers/hash-controller.js";
import { carriedLabelFont } from "../../controllers/hydration-controller.js";
import { LABEL_FONT_FALLBACKS } from "../../../domains/serving.js";
import { DEFAULT_REGULATION_THRESHOLDS, evaluateRegulation, newRegulationState, recordFrameTime } from "../derivations/regulation.js";
import { GRAPH_DRAWING_BLIP, GRAPH_FRAME_BLIP, GRAPH_REGULATION_BLIP, type TDrawingReason, type TWakeCause } from "../../../domains/graph-blips.js";
import { actorBars, seqLabelOf, seqNodesOf, sequenceExtentOf, type SeqNode } from "../derivations/sequence-model.js";
import { type FGNode, type FGLink, type XYZ, GRAPH_SCENE_EVENT, linkEndId } from "../domains/graph-types.js";
import { forceLayout, type IGraphLayout } from "../derivations/polymorphic-layout.js";
import { NODE_TEXT_COLOR, chipTextHeight } from "../derivations/layout-forces.js";
import { paintMarkScene, type ShapeThree } from "./node-shapes.js";
import { PolymorphicFocus, NODE_RENDER_ORDER } from "../controllers/focus-controller.js";
import { EnclosureController, type EnclosureThree, ENCLOSURE_FILL_OPACITY, ENCLOSURE_EDGE_OPACITY, type Obj3D } from "./enclosure.js";
import { presentationForType } from "../derivations/type-presentation.js";
import { EVERY_FRAME, type NodeMark } from "../domains/graph-scene.js";
import { appAccessLevel } from "../../controllers/view-query-controller.js";
import { PaneOpenSchema, addsToSelection, type DesiredPane, type TPaneOpen } from "../../derivations/pane-kinds.js";

/**
 * shu-graph-scene: the A-Frame / ForceGraphVR rendering surface, extracted from shu-polymorphic-graph-view so the scene is
 * reusable independent of the data feed and the control bar. It owns the WebGL scene, camera, render loop, node objects,
 * focus/highlight, drag, enclosures, and the gantt/sequence axes, and is driven entirely by inputs pushed from a host:
 *
 *   setModel(model): the quads/clusters to render (the host's time-filtered slice)
 *   setConfig(patch): the layout choices (view type, flatten, grouping, z basis, label-as-z)
 *   setAxioms(overlay): the DL view's axioms on the nodes and edges it draws, or null without them
 *   setTimeCursorValue(ms): the depth-basis cursor (a re-style, not a data change)
 *   setSelectedSubject(id): the highlighted node (pins it, dims the rest)
 *   setPreview(preview): a type hovered in a legend, or nodes a host points at (dims the rest)
 *   scopeToType(type): an embedded schema view: fit around one type's node
 *
 * It emits (bubbles, composed) the constants in GRAPH_SCENE_EVENT. The host (a data-feeding wrapper such as
 * shu-polymorphic-graph-view, or an embedding column) owns fetch/SSE/selection publication and the controls, and forwards
 * those events to the app.
 *
 * Light DOM (createRenderRoot returns this): A-Frame resolves its scene/camera through document.querySelector, which a
 * shadow root would hide: a shadow-mounted scene boots but never attaches its graph.
 */

/** The data the scene renders: the host's time-filtered slice plus the cluster metadata the layout and filter need. */
export interface GraphSceneModel {
	quads: TQuad[];
	visibleQuads: TQuad[];
	clusters: TCluster[];
	knownClusters: Map<string, TCluster>;
	hiddenGraphs: string[];
	/** The predicates whose edges are hidden (the filter's properties group), dropped from the visible model, so every
	 *  medium (WebGL, sequence, still, JSON-LD, the accessible document) reads the same edge set. */
	hiddenPredicates: string[];
	site?: string;
	perTypeLimit: number;
	timeCursor: number | null;
}

/** The layout choices, owned and persisted by the host, pushed down as a plain object so the scene doesn't hold persisted state. */
export interface GraphSceneConfig {
	viewType: ViewType;
	flatten: boolean;
	grouped: boolean;
	groupBy: GroupKeyMode;
	zBasis: "valid" | "indexed" | "connections";
	labelAsZ: boolean;
	/** Keep the active (selected) node centred and readable: every selection change and every settle re-frames its
	 *  local context (the node + its 1-hop neighbours), keeping the user's orbit. */
	follow: boolean;
	/** Prune nodes without a visible edge: a visible-model adjustment, so every medium (WebGL, sequence, still,
	 *  JSON-LD, the accessible document) reads the same pruned graph. */
	prune: boolean;
	/** Hold the accessible document open beside the scene. It is always there and always current: a keyboard reader
	 *  tabs into it, and this shows it to everyone else too. */
	readAsDocument: boolean;
}

/** One vertex the host must persist for a gantt-bar reschedule: the vertex to rewrite and its new start and end. */
export interface RescheduleUpdate {
	label: string;
	id: string;
	data: { startedAtTime: string; endedAtTime: string };
}

/** The graph-scene-changed payload: the control-bar inputs the host renders. */
export interface GraphSceneChangedDetail {
	groupByAxes: string[];
	/** The options the active view forces, so a host offers only the ones this view honours. */
	forces: TViewForces;
	paintOptions: Array<{ id: string; label: string }>;
	counts: { nodes: number; edges: number; relTypes: number; omitted: TCounted; pruned: number };
	latestStep: string | null;
	axisLegend: { from: string; to: string; count: number } | null;
	/** The user's drag-pins (id → [x,y]) so the host can persist them across reloads. */
	pins: Record<string, [number, number]>;
}

/** Empty state schema: the scene doesn't hold persisted state: all inputs are pushed via setModel/setConfig. */
const SceneStateSchema = z.object({});

// Node chips mirror the SVG overview: the cluster type-colour as fill, dark text, a light stroke:
// readable on either theme because the cluster palette is always light. Only the chrome (scene
// background, edges) follows the document theme tokens.
const NODE_BORDER_COLOR = "#cccccc";
// The glow the ACTIVE node carries: the node whose column is open, the one being read. Drawn behind the mark, so it
// surrounds a chip and a lane bar alike; its colour cycles through the theme's warm ramp (see polymorphic-highlight).

// three-forcegraph forces link objects to renderOrder 10; draw nodes above that (edges draw behind), labels between.
// The focus subsystem declares NODE_RENDER_ORDER / FOCUS_RENDER_ORDER (it drives the chip pop).
const EDGE_LABEL_RENDER_ORDER = 15;
const EDGE_LABEL_TEXT_HEIGHT = 2; // edge labels' world text height
// A persistent arrowhead on every edge so its direction (source → target) is always clear, not just during a
// transient particle burst. Sized to the chip scale (~3) and placed past the link's midpoint toward the target.
const ARROW_LENGTH = 3.5;
const ARROW_REL_POS = 0.68;
const LINK_OPACITY = 0.55; // resting edge opacity; focus raises incident edges to full and dims the rest (the focus subsystem reads it via the injected line tiers)

// Two debounce tiers, by intent. A data arrival (new/removed nodes streaming in) coalesces into ~half-second clumps:
// one repaint per window, so a steady trickle arrives as occasional batches that settle against the (pinned) existing
// layout: rather than a per-node reheat that keeps the whole graph wiggling. A layout change (flatten / dag / group /
// type-filter) coalesces longer so rapid toggles collapse into ONE transition, then animates as a controlled tween.
const DATA_DEBOUNCE_MS = 500;
// The scene renders on demand: a discrete change (data, selection, resize, theme) is drawn on the next frame, and then
// the scene idles. A change made between gate ticks is seen by the next tick, which starts the renderer's loop, and the
// renderer draws before the tick after it stops the loop: two ticks draw one frame. A motion (layout settle, tween,
// drag, magnify ease, camera damping) keeps the scene drawing for as long as it moves, and no longer.
const DIRTY_GRACE_FRAMES = 2;
// The library moves a particle a hundredth of its link each drawn frame, so a particle takes this many frames to cross.
const PARTICLE_CROSSING_FRAMES = 100;
// Cadence for the canvas-geometry wake detector (mouse-pick bounds + viewport aspect watchdog), sampled even when idle.
const CANVAS_GEOMETRY_EVERY = 15;
const LAYOUT_DEBOUNCE_MS = 450;

// The enclosure subsystem declares the enclosure fill/edge/label render orders + heights (it draws the boxes); they're
// re-used here by the gantt axis ruler + the gantt drag ghost (same render layer) and the focus tier consts.
// The slice of A-Frame's bundled THREE that the group enclosures + the gantt overlays drive. Constructed at runtime via the scene's OWN
// THREE instance (AFRAME.THREE), never a separately imported `three`, which would be a second copy whose objects
// the scene can't render. Typed structurally so this view doesn't depend on a three .d.ts.
/** The slices of THREE that the enclosures, a chip, a painted shape, the gantt overlays and a pick construct. */
type ThreeNs = GanttThree & ChipThree & ShapeThree & TPickThree;
const aframeThree = (): ThreeNs | undefined => (globalThis as { AFRAME?: { THREE?: ThreeNs } }).AFRAME?.THREE;

/** The slice of A-Frame's component registry where the scene replaces a component. */
type TAframeComponents = { components: Record<string, { schema: unknown } | undefined>; registerComponent(name: string, definition: { schema: unknown }): void };

/** A-Frame's text component reads its font from a CDN when it draws. Its one user here is the graph library's hover
 *  tooltip, which repeats the name every chip draws, and troika draws every label (SH28), so the component keeps its schema,
 *  which the tooltip's attributes parse against, and doesn't draw. */
function silenceAframeText(): void {
	const aframe = (globalThis as { AFRAME?: TAframeComponents }).AFRAME;
	if (aframe === undefined) throw new Error("shu-graph-scene: A-Frame isn't loaded, so its text component can't be replaced");
	const text = aframe.components.text;
	if (text === undefined) throw new Error("shu-graph-scene: A-Frame doesn't register a text component to replace");
	delete aframe.components.text;
	aframe.registerComponent("text", { schema: text.schema });
}
silenceAframeText();

const FOCUS_DIM = 0.25; // dimmed-but-readable: a focused node de-emphasises its surroundings without making them vanish

// Per-kind opacity for each focus tier (see @haibun/shu/graph/focus-policy.ts). Only the line rests below full (LINK_OPACITY); the
// enclosure fill dims to 30% of its own faint resting value rather than to FOCUS_DIM.
const NODE_TIERS: KindTiers = { full: 1, dimmed: FOCUS_DIM, resting: 1 };
const LINE_TIERS: KindTiers = { full: 1, dimmed: FOCUS_DIM, resting: LINK_OPACITY };
const EDGE_LABEL_TIERS: KindTiers = { full: 1, dimmed: FOCUS_DIM, resting: 1 };
const ENCLOSURE_FILL_TIERS: KindTiers = { full: ENCLOSURE_FILL_OPACITY, dimmed: ENCLOSURE_FILL_OPACITY * 0.3, resting: ENCLOSURE_FILL_OPACITY };
const ENCLOSURE_EDGE_TIERS: KindTiers = { full: ENCLOSURE_EDGE_OPACITY, dimmed: FOCUS_DIM, resting: ENCLOSURE_EDGE_OPACITY };
const ENCLOSURE_LABEL_TIERS: KindTiers = { full: 1, dimmed: FOCUS_DIM, resting: 1 };

type Bbox = { x: [number, number]; y: [number, number]; z: [number, number] };

/** The subset of the ForceGraphVR API the scene drives; exported so the host can type its delegated `graph` accessor. */
export interface FGInstance {
	graphData(data: { nodes: FGNode[]; links: FGLink[] }): FGInstance;
	width(w: number): FGInstance;
	height(h: number): FGInstance;
	backgroundColor(color: string): FGInstance;
	nodeLabel(fn: (n: FGNode) => string): FGInstance;
	nodeThreeObject(fn: (n: FGNode) => unknown): FGInstance;
	linkColor(fn: (l: FGLink) => string): FGInstance;
	linkOpacity(o: number): FGInstance;
	linkWidth(w: number): FGInstance;
	linkCurvature(c: number): FGInstance;
	linkThreeObjectExtend(v: boolean): FGInstance;
	linkThreeObject(fn: (l: FGLink) => unknown): FGInstance;
	linkPositionUpdate(fn: (obj: unknown, coords: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }, link: FGLink) => void): FGInstance;
	numDimensions(n: number): FGInstance;
	warmupTicks(n: number): FGInstance;
	cooldownTicks(n: number): FGInstance;
	cooldownTime(ms: number): FGInstance;
	onEngineStop(fn: () => void): FGInstance;
	showNavInfo(v: boolean): FGInstance;
	onNodeClick(fn: (n: FGNode, e?: MouseEvent) => void): FGInstance;
	onNodeHover(fn: (n: FGNode | null, prev: FGNode | null) => void): FGInstance;
	onLinkHover(fn: (l: FGLink | null, prev: FGLink | null) => void): FGInstance;
	onLinkClick(fn: (l: FGLink) => void): FGInstance;
	linkDirectionalParticleWidth(w: number): FGInstance;
	linkDirectionalParticleColor(fn: (l: FGLink) => string): FGInstance;
	emitParticle(l: FGLink): FGInstance;
	linkDirectionalArrowLength(n: number): FGInstance;
	linkDirectionalArrowColor(fn: (l: FGLink) => string): FGInstance;
	linkDirectionalArrowRelPos(n: number): FGInstance;
	d3Force(name: string, force?: unknown): { strength(s: number | (() => number)): unknown } | undefined | FGInstance;
	d3ReheatSimulation(): FGInstance;
	getGraphBbox(): Bbox | null;
}

const DEFAULT_MODEL: GraphSceneModel = {
	quads: [],
	visibleQuads: [],
	clusters: [],
	knownClusters: new Map(),
	hiddenGraphs: [],
	hiddenPredicates: [],
	perTypeLimit: DEFAULT_PER_TYPE_LIMIT,
	timeCursor: null,
};
const DEFAULT_CONFIG: GraphSceneConfig = {
	viewType: VIEW.force,
	flatten: false,
	grouped: false,
	groupBy: "type",
	zBasis: "valid",
	labelAsZ: false,
	follow: false,
	prune: false,
	readAsDocument: false,
};

/** The slice of the renderer this scene drives: its size, its pixel ratio, its canvas, and whether it is presenting in VR. */
type TSceneRenderer = {
	setSize(w: number, h: number, updateStyle: boolean): void;
	getPixelRatio(): number;
	domElement: HTMLCanvasElement;
	xr?: { isPresenting?: boolean };
	/** The WebGL context a drawn frame is measured on, and what the last frame drew. */
	getContext?(): unknown;
	info?: { render?: { calls: number } };
	/** Release the WebGL context now rather than at collection. */
	dispose?(): void;
	forceContextLoss?(): void;
};

/** The a-scene element as A-Frame extends it: the renderer and camera it holds once loaded, and the events it emits. */
/** The object the library's A-Frame component sets on its entity each time the library laid out its data. */
const FORCEGRAPH_OBJECT = "forcegraphGroup";
/** The library's A-Frame entity: its component, which holds the inner three-forcegraph instance, and its objects. */
type TForcegraphElement = Element & { components?: { forcegraph?: { forceGraph?: TGraphEnginePacing } }; getObject3D(type: string): unknown };
type TSceneElement = HTMLElement & TAframeScene & { renderer?: TSceneRenderer; camera?: TSceneCamera; emit(name: string, detail?: unknown, bubbles?: boolean): void };

export class ShuGraphScene extends ShuElement<typeof SceneStateSchema> {
	readonly #observers = new ObserverController(this);
	/** The scene's engine, frame jobs, layout tween and data pipeline, and the page's clock and frame timing. */
	readonly #parts = new SceneController();
	/** The graph as an accessible document, which states what the picture shows of each node. */
	#reading?: A11yRenderer;
	/** The host's time-filtered data slice; replaced whole via setModel. */
	private model: GraphSceneModel = DEFAULT_MODEL;
	/** The host's layout choices; patched via setConfig. */
	private config: GraphSceneConfig = DEFAULT_CONFIG;

	/** How this scene is drawn. The library-backed renderer is built at mount; a caller that shows the graph in
	 *  another medium, a report, a still, a test that reads what was drawn, sets its own before mounting. */
	renderer?: TGraphRenderer;

	/** The ForceGraphVR instance, public so the host can delegate its `graph` accessor 1:1. The renderer displays the graph;
	 *  what remains here is the camera, the controls, and the force simulation (see the plan doc). */
	graph?: FGInstance;
	// Render-on-demand bookkeeping: a monotonic frame counter, the frame up to which a discrete change keeps the scene
	// drawing, and whether the A-Frame render loop is currently paused because motion has ended.
	private rafFrame = 0;
	private dirtyUntilFrame = 0;
	private dirtyCause: TWakeCause = "data"; // what set dirtyUntilFrame, named while its grace lasts
	private drawing?: TGraphFrameLoop; // the gate on the renderer's loop; the scene is paused while it is not drawing
	/** The library's entity once the scene loaded. The library sets its object on the entity once it laid out its first
	 *  data, and until then its engine doesn't hold a layout to tick, so the scene doesn't feed or pace it: a reheat before
	 *  then makes the library's next frame read a layout that doesn't exist. */
	private forcegraphEl?: TForcegraphElement;

	/** Whether the library laid out its first data. */
	private get libraryLaidOut(): boolean {
		return this.forcegraphEl?.getObject3D(FORCEGRAPH_OBJECT) !== undefined;
	}
	private lastBreathAt = 0; // when the active node's glow was last redrawn; the breath runs on BREATH_MS, not on frames
	private regulation = newRegulationState(); // the scene's own regulator of decorative motion, on what a frame takes
	/** Why the scene draws now, since when and which frame, and how many changes woke it since, so each change of reason
	 *  records how long the last one drew. */
	private drawingFor: { reason: TDrawingReason; since: number; frame: number; wakes: number } = { reason: "rest", since: 0, frame: 0, wakes: 0 };

	// Set when the focus (selection/hover) changes or a settle rebuilt the visuals: the render loop keeps drawing until it
	// applies the focus at rest, then clears it. Distinct from dirtyUntilFrame (a fixed grace): a focus may take longer.
	private focusDirty = false;
	private get viewType(): ViewType {
		return this.config.viewType;
	}
	/** THE layout options in force: the reader's choices with the active view's own settled values over them. Every
	 *  consumer reads this rather than `config`, so a view that forces a value settles it once for all of them. */
	private get effective(): GraphSceneConfig {
		return { ...this.config, ...this.renderType.forces };
	}
	private get flatten(): boolean {
		return this.effective.flatten;
	}
	private get labelAsZ(): boolean {
		return this.effective.labelAsZ;
	}
	private get groupBy(): GroupKeyMode {
		return this.config.groupBy;
	}

	/** The group-by axes offered: `@type` and the highest-priority actor always, plus each actor predicate that
	 *  appears on a visible node, plus the serving site once the view holds data from MORE than one site (a single-site
	 *  graph doesn't have sites to separate): all derived from the data, so an axis the graph does not carry never shows. */
	private get groupByAxes(): string[] {
		const roleLabels = roleEdgeLabels();
		const present = new Set<string>();
		const sites = new Set<unknown>();
		for (const n of this.visibleModel().nodes)
			if (n.properties) {
				for (const rel of roleLabels) if (n.properties[rel] !== undefined) present.add(rel);
				if (n.properties[SITE_KEY] !== undefined) sites.add(n.properties[SITE_KEY]);
			}
		return ["type", "role", ...roleLabels.filter((rel) => present.has(rel)), ...(sites.size > 1 ? [SITE_KEY] : [])];
	}
	/** Grouping/enclosures only apply when the user turned grouping on AND the active view is NOT a lane view (a lane view
	 *  IS its own grouping: its lanes are the axis; role/type enclosure boxes would overlap the lanes). The
	 *  enclosure controller and the settle-time geometry pass both read this so a lane view never draws boxes. */
	private groupingActive(): boolean {
		return this.effective.grouped;
	}
	private edgeLabelColor = "#555555";
	private edgeLineColor = "#888888";
	/** The DL view's axioms on the nodes and edges the scene draws; null outside the DL view. */
	private axioms: TAxiomOverlay | null = null;
	private chipTextColor = NODE_TEXT_COLOR; // text ON a node chip (light type-colour bg), dark in both themes (--shu-fg-on-swatch)
	private sceneTextColor = "#e6e6e6"; // text OFF a chip, on the scene bg (gantt bar labels), follows --shu-fg (white in dark)
	private glowRamp: readonly string[] = GLOW_RAMP.dark; // which warm ramp the glow cycles through, chosen by theme
	private focusEdgeColor = "#222222"; // full-contrast foreground: a focused node's edges + labels brighten to it
	private particleColor = "#1a6b3c";
	private focusTextPx = 13; // from --shu-font-md: the pop matches the app's own text size (follows --shu-scale)
	// The single interface to the live render world, late-bound three.js leaf refs + the shared mutable graph-state
	// collections, behind typed getters read at call time. The component still OWNS the refs/maps (DataPipeline mutates
	// nodeMap); subsystems extracted next read this ONE injected context instead of scattered private-field touches.
	private ctx: RenderContext<FGNode, FGLink> = new RenderContext<FGNode, FGLink>({
		camera: () => this.fgCamera,
		controls: () => this.cameraCtl.controls,
		container: () => this.fgContainer,
		renderer: () => this.fgRenderer,
		canvas: () => this.fgCanvas,
		sceneEl: () => this.fgSceneEl,
		nodeMap: () => this.nodeMap,
		currentLinks: () => this.currentLinks,
		linkMap: () => this.linkMap,
	});
	// The camera controller: the orbit controls, the frame's fit to the column, following, framing and the nudges. Its
	// camera machine owns the arithmetic of every move; both read the render world and the layout through call-time accessors.
	private cameraCtl: CameraController = new CameraController({
		world: this.ctx,
		fitMove: () => this.renderType.fitMove(),
		reframeMode: () => this.renderType.reframeMode(),
		ganttExtent: () => ganttExtentOf(this.ganttTargets.values()),
		sequenceExtent: () => {
			const layout = this.renderType.seqLayout?.();
			return layout === undefined ? null : sequenceExtentOf(layout);
		},
		layoutRests: () => this.#parts.engine.mode === "frozen",
		activeId: () => this.activeSubject,
		follows: () => this.config.follow,
		project: (id) => this.pick.project(id),
		guide: () => this.querySelector<HTMLElement>("#polymorphic-a11y"),
		sizeRenderer: (w, h) => this.renderer?.size(w, h),
		refreshPickBounds: () => this.pick.refreshBounds(),
		markDirty: (cause, grace) => this.markDirty(cause, grace),
		teardown: (end) => this.autoTeardown(end),
	});
	// The data-flow subsystem: owns the per-id node/link maps + parked positions + the sqrt-age depth scale, and turns
	// the quad model into {nodes, links, freshLinks}. Wired like the camera, constructor-injected accessors read at
	// call time, so a per-repaint-refreshed component field (group anchors, the layout-target caches) is always current.
	// Public so the host delegates its `pipeline` accessor 1:1 (unit tests write pipeline.nodeMap= to feed a node set).
	pipeline = this.#parts.pipeline({
		viewType: () => this.viewType,
		flatten: () => this.flatten,
		// The ONE grouping predicate every consumer reads: a lane view's bars ARE its grouping, so a remembered "grouped"
		// choice must not place its nodes in container cells: that overrides the lane placement and the diagram is lost.
		grouped: () => this.groupingActive(),
		groupBy: () => this.groupBy,
		quads: () => this.model.quads,
		visibleQuads: () => this.model.visibleQuads,
		hiddenGraphs: () => this.model.hiddenGraphs,
		visibleModel: () => this.visibleModel(),
		lastModelHash: () => this.lastModelHash,
		timeCursor: () => this.model.timeCursor, // the pinning-aware cursor the host resolved (a snapshot-pinned view reads its frozen instant)
		zBasis: () => this.config.zBasis,
		relationOf: relationOfPredicate,
		validTimeFieldFor: (type) => validTimeFieldOf(type),
		groupAnchors: () => this.enclosureCtl.anchors,
		groupSizes: () => this.enclosureCtl.sizes,
		setGanttTargets: (t) => {
			this.ganttTargets = t;
		},
		setGanttScale: (s) => {
			this.ganttScale = s;
		},
		setGanttAdornment: (a) => {
			this.ganttAdornment = a;
		},
		setGanttShapeSig: (sig) => this.setGanttShapeSig(sig),
		// THE crux: node-z reads the SAME RenderType.lanePlacement the force lane-y reads (layoutForFeed), so the
		// force target and the data-assigned z come from one source and can't diverge mid-settle.
		laneZ: (id) => this.renderType.lanePlacement(id)?.z,
		lanePinXY: (id) => {
			const lp = this.renderType.lanePlacement(id);
			if (!lp) return undefined;
			// A view that lays out in one plane doesn't carry an x in its placement and names the plane it draws on instead.
			const x = lp.x ?? this.renderType.lanePlaneX;
			return x !== undefined ? { x, y: lp.y } : undefined;
		},
		userPinXY: (id) => this.userPins.get(id),
		startNewcomerPop: (n) => this.focusCtl.seedNewcomerPop(n),
	});
	// The focus subsystem: the whole purely-visual dim/highlight + the focus-chip MAGNIFY pop. Wired like the camera:
	// constructor-injected accessors read at call time, so a late-bound graph, a per-repaint nodeMap, or a theme-recoloured
	// colour field is always current; it OWNS the magnify animation state, the component delegates and doesn't read state back.
	// (Named focusCtl, not focus, HTMLElement.focus() is a method on the element.)
	private focusCtl = new PolymorphicFocus({
		decorates: () => this.decorates(),
		focusId: () => this.focusId,
		selectedId: () => this.activeSubject,
		preview: () => this.preview,
		groupOf: (n) => groupKeyOf(n, this.config.groupBy),
		nodeMap: () => this.nodeMap,
		currentLinks: () => this.currentLinks,
		enclosures: () => this.enclosureCtl.enclosures,
		graph: () => this.graph,
		engineFrozen: () => this.#parts.engine.mode === "frozen",
		pinNode: (n) => this.dataPinnedIds.push(n.id),
		worldPerPxAt: (pos) => this.cameraCtl.camera.worldPerPxAt(pos),
		focusEdgeColor: () => this.focusEdgeColor,
		edgeLineColor: () => this.edgeLineColor,
		edgeLabelColor: () => this.edgeLabelColor,
		focusTextPx: () => this.focusTextPx,
		glowRamp: () => this.glowRamp,
		nodeTiers: NODE_TIERS,
		lineTiers: LINE_TIERS,
		edgeLabelTiers: EDGE_LABEL_TIERS,
		enclosureFillTiers: ENCLOSURE_FILL_TIERS,
		enclosureEdgeTiers: ENCLOSURE_EDGE_TIERS,
		enclosureLabelTiers: ENCLOSURE_LABEL_TIERS,
	});
	// The group-enclosure subsystem: the box/border/title meshes + the per-group ring anchors + footprint radii that drive
	// the cohesion force. Wired like the camera, accessors read at call time, so a per-repaint nodeMap or a recoloured
	// label colour is always current; it OWNS the enclosure maps + the shared unit geometries, the component delegates.
	private enclosureCtl = new EnclosureController({
		three: () => aframeThree() as EnclosureThree | undefined,
		nodeMap: () => this.nodeMap,
		groupBy: () => this.groupBy,
		grouped: () => this.groupingActive(), // a lane/2D view (gantt/sequence) suppresses enclosures: its lanes/actors ARE the grouping
		edgeLabelColor: () => this.edgeLabelColor,
		enclosureParent: () => this.enclosureParent(),
		applyEnclosureFocus: () => this.focusCtl.applyEnclosureFocus(),
	});
	// The render-type subsystem: one RenderType per layout (force, td/lr layered, gantt, sequence), each owning BOTH sides
	// of every layout dispatch (the shared pin placement, mark time, drag mode, z included in the model hash) so the force config and the
	// node placement can't diverge. The registry shares one injected deps (the live gantt target cache) plus the visible
	// model deps (nodes + edges + label resolvers) the sequence and the layered flow read. `renderType` resolves the
	// active one from state.viewType, so switching the view-type select swaps it.
	private renderTypes = buildRenderTypeRegistry(
		{ ganttTarget: (id) => this.ganttTargets.get(id), ganttPlacement: () => ({ scale: this.ganttScale, count: this.ganttTargets.size }) },
		{
			seqNodes: () => this.seqNodes(),
			seqEdges: () => this.visibleModel().edges.map((e) => ({ from: e.from, to: e.to, predicate: e.predicate })),
			seqOptions: () => ({
				labelOf: (participantId) => seqLabelOf(participantId, this.nodeMap.get(participantId), roleNounFor),
				actorEdges: { from: fromActorEdgeLabels(), to: toActorEdgeLabels() },
			}),
		},
	);
	private get renderType(): RenderType {
		const rt = this.renderTypes.get(this.viewType) ?? this.renderTypes.get(VIEW.force);
		if (!rt) throw new Error("shu-graph-scene: render-type registry is missing the force fallback");
		return rt;
	}
	// Nodes pinned only for the duration of a streamed-data settle so the feed's engine reheat can't move them
	// (visible jitter); released at the next engine stop. Proven in polymorphic-forces.test.ts.
	private dataPinnedIds: string[] = [];
	/** Positions the user pinned by dragging, id → {x,y}. Applied by the data pipeline (userPinXY) so a dragged node returns
	 *  to where it was left after a reload; the host persists these across reloads (a page-wide layout choice). */
	private userPins = new Map<string, { x: number; y: number }>();
	private compassFgColor = "#e0e0e0";
	private compassAccentColor = "#4ac080";
	private compassDimColor = "#666";
	// The per-id node/link maps and parked positions are OWNED by the DataPipeline (its repaint-stable bookkeeping);
	// these getters delegate so the rest of the component reads one source. The pipeline reassigns nodeMap/linkMap
	// each toGraphData, so a getter (not a captured reference) is required.
	private get parkedPositions(): Map<string, { x: number; y: number }> {
		return this.pipeline.parkedPositions;
	}
	/** The nodes the scene draws, by id, by which a host names what the scene draws. */
	get nodeMap(): Map<string, FGNode> {
		return this.pipeline.nodeMap;
	}
	private get linkMap(): Map<string, FGLink> {
		return this.pipeline.linkMap;
	}
	private compassEl: HTMLCanvasElement | null = null;
	private infoEl: HTMLElement | null = null; // hover overlay above the controls: label · type · its time with units
	private currentLinks: FGLink[] = [];
	private repaintTimer?: () => void;
	private layoutTimer?: () => void;
	private lastModelHash?: number;
	/** The hash of the scene's inputs at the last repaint, compared before a model is built (PF31). */
	private lastInputHash?: number;
	// Per-repaint memo of the visible model and its sequence-node projection. The layered/sequence render types cache
	// their layout on the seqNodes() array reference and expect a fresh array only per repaint; seqNodes() built a new
	// array every call, so those caches never hit and the layout was recomputed ~once per node per feed. Cleared at each
	// repaint entry (invalidateModelCache), so the reference is stable within a repaint and fresh across repaints.
	private modelCache?: GraphModel;
	/** The nodes prune took out of the visible model last built. */
	private prunedCount = 0;
	private seqNodesCache?: SeqNode[];
	// The ghost tween of a layout change: each frame the node pins ease from where they were toward where they land.
	// Picking and dragging: which node a press, a click or a projection names, and a node's drag, whose machine holds the
	// pin geometry. After release the dragged node's pin persists until the next layout change re-solves and releases it.
	private pick = new PickController({
		world: this.ctx,
		three: () => aframeThree(),
		drag: {
			hold: () => this.#parts.engine.hold(),
			freeze: () => this.#parts.engine.freeze(),
			dragReschedules: () => this.renderType.dragReschedules,
			updateGhost: (n) => {
				const target = this.ganttTargets.get(n.id);
				if (target !== undefined && this.ganttScale !== undefined) this.ganttOverlay.drawGhost(n, target, this.ganttScale);
			},
			clearGhost: () => this.ganttOverlay.clearGhost(),
			commit: (n) => this.commitGanttDrag(n),
			selectedId: () => this.activeSubject,
			dropDataPin: (id) => {
				this.dataPinnedIds = this.dataPinnedIds.filter((x) => x !== id);
				// Record where the user left it, so a reload can pin it back here (persisted by the host). The pin is read
				// from the drag's own fx/fy, where the pointer left the node, not from x/y, which the engine writes on its
				// next tick and which therefore still holds the pre-drag place when the drop lands between ticks.
				const n = this.nodeMap.get(id);
				const x = n?.fx ?? n?.x;
				const y = n?.fy ?? n?.y;
				if (n && x != null && y != null) {
					this.userPins.set(id, { x, y });
					n.x = x;
					n.y = y;
					this.#reading?.mark();
				}
				// Emit at drop so the host persists the pin now: the sole carrier of the pin set to the host.
				this.emitSceneChanged();
			},
		},
		tweening: () => this.#parts.tween.running,
		clicked: (node, e) => {
			if (node) this.onNodeClick(node, e);
			// Empty space is the reader not choosing a record on the page; the host relays the active record back through setSelectedSubject.
			else if (this.selectedSubject) dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: entryOf([], appAccessLevel()) });
		},
		left: () => {
			this.updateHoverInfo(null);
			if (this.hoverSubject) {
				this.hoverSubject = null;
				this.applyFocus();
			}
		},
		markDirty: (cause) => this.markDirty(cause),
		teardown: (end) => this.autoTeardown(end),
	});
	private selectedSubject: string | null = null; // sticky: the current column-view node (via the shared selection system)
	private hoverSubject: string | null = null; // transient: the hovered node
	private preview: TGraphPreview | null = null; // what a preview lights: a type hovered in the filter legend, or nodes a host points at
	// Ontology (T-Box) mode: the view shows the SCHEMA that drives it: the Class + Property hierarchy from
	// getOntologyQuads: instead of the live instance data. While on, the live feeders (refetch/SSE) are suspended so a
	// streamed batch can't clobber the fixed ontology snapshot; toggling off refetches the live graph.
	private fgRenderer?: TSceneRenderer;
	// Public so the host delegates its `fgCamera` accessor 1:1 (tests project through it and wait for it before driving).
	fgCamera?: TSceneCamera;
	private fgCanvas?: HTMLCanvasElement;
	private fgContainer?: HTMLElement;
	private fgSceneEl?: HTMLElement & { emit(name: string, detail?: unknown, bubbles?: boolean): void };
	// Gantt layout: per-node calendar-grid target (subject id → world x/y of the bar CENTRE, plus the bar width = its
	// duration), recomputed in toGraphData when viewType is "gantt". The groupX/groupY forces pull each task to its
	// slot; the node object is a duration bar of width `w`. Non-task nodes don't have an entry.
	// Gantt layout target per task: y = lane (one row each, force-pulled), z = the bar's CENTRE on the linear time
	// axis (data-assigned in toGraphData), zLen = its duration as a z-span (the box depth). Time is the z axis; the
	// camera pivots so z lies flat/horizontal on screen.
	private ganttTargets = new Map<string, GanttTarget>();
	// Calendar scale for the gantt layout: drag maps a node's new x back to a time through this (inverse of timeX).
	private ganttScale: { min: number; span: number } | undefined;
	// The calendar ruler the layout pass produced (baseline z-range + tick marks + baseline y); null off-gantt.
	private ganttAdornment: Adornment = null;
	// three-forcegraph caches each node's 3D object and only rebuilds when the nodeThreeObject accessor reference
	// changes. A node's SHAPE can change without its identity, chip↔gantt-box on a view switch, and a gantt span/
	// duration change resizes every bar (zLen is global, built into the box geometry). recomputeGanttTargets flags the
	// next feed (via setGanttShapeSig, the bar-width fingerprint) to re-bind the accessor: a full node rebuild.
	private nodeRebuildPending = false;
	private ganttShapeSig = "";
	// The gantt calendar ruler and a dragged bar's ghost, parented like the enclosures.
	private ganttOverlay = new GanttOverlay({
		three: () => aframeThree(),
		parent: () => this.enclosureParent(),
		unitEdges: (T) => {
			this.enclosureCtl.ensureUnitBox(T);
			return this.enclosureCtl.unitEdges;
		},
		colors: () => ({ text: this.compassFgColor, accent: this.compassAccentColor }),
	});

	constructor() {
		super(SceneStateSchema, {});
	}

	/** Light DOM: A-Frame element scanners can't reach shadow DOM. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	/** Replace the whole data slice and repaint via the streamed-data path (a trailing coalesce, positions preserved). */
	setModel(model: GraphSceneModel): void {
		this.model = model;
		this.revealEmbedScope();
		this.scheduleData();
	}

	/** The user's drag-pins as a plain record (id → [x,y]) for the host to persist across reloads. */
	getUserPins(): Record<string, [number, number]> {
		const out: Record<string, [number, number]> = {};
		for (const [id, p] of this.userPins) out[id] = [p.x, p.y];
		return out;
	}

	/** Restore the user's drag-pins from a persisted record; the data pipeline applies them (userPinXY) as nodes arrive. */
	setUserPins(pins: Record<string, readonly unknown[]>): void {
		const m = new Map<string, { x: number; y: number }>();
		for (const [id, [x, y]] of Object.entries(pins)) if (typeof x === "number" && typeof y === "number") m.set(id, { x, y });
		this.userPins = m;
		if (this.graph) this.scheduleData();
	}

	/** Patch the layout choices. Owns the reframe + node-rebuild decisions a view/z/label change entails, then repaints:
	 *  a label-as-z change re-renders chip text only (data path); every other change is a layout transition (tween path). */
	setConfig(patch: Partial<GraphSceneConfig>): void {
		const prev = this.config;
		this.config = { ...prev, ...patch };
		// Config seeded before the library laid out its first data: stored only; the first repaint reads it.
		if (!this.libraryLaidOut) {
			this.emitSceneChanged();
			return;
		}
		if (patch.viewType !== undefined && patch.viewType !== prev.viewType) {
			const prevType = this.renderTypes.get(prev.viewType) ?? this.renderTypes.get(VIEW.force);
			// A view built on ACTORS needs its actors: a hidden actor type leaves the exchange without a participant, so
			// choosing the view reveals them, exactly as it settles the layout options it cannot honour.
			if (this.renderType.needsActors) this.revealActorTypes();
			// The new view may force options the old one honoured (a lane view settles grouping, flatten and label-as-depth),
			// so the enclosures and the chip text both still show the view being left.
			if (this.renderType.forces.grouped === false) this.enclosureCtl.clearEnclosures();
			if ((prevType?.forces.labelAsZ ?? this.config.labelAsZ) !== this.labelAsZ) this.nodeRebuildPending = true;
			const nextMode = this.renderType.reframeMode();
			if (prevType && nextMode !== prevType.reframeMode()) this.cameraCtl.camera.queueFrame(nextMode);
			// Crossing a node-shape boundary (chip ↔ gantt bar ↔ sequence activation bar) must rebuild the lib's identity-cached
			// node objects; a force↔td↔lr switch keeps the chips and must not.
			if (viewChangeRebuildsNodes(prev.viewType, patch.viewType)) this.nodeRebuildPending = true;
		}
		if (patch.follow !== undefined && patch.follow && !prev.follow && this.activeSubject) this.cameraCtl.follow(this.activeSubject); // turning follow on centres the active node at once
		if (patch.readAsDocument !== undefined && patch.readAsDocument !== prev.readAsDocument) {
			// Showing or hiding the reading changes one attribute on a region the renderer already keeps current: the
			// model and the layout don't move, so this re-renders the template and stops there.
			this.requestUpdate();
			this.emitSceneChanged();
			return;
		}
		if (patch.prune !== undefined && patch.prune !== prev.prune) {
			// A node-set change is the data path (the layout keeps placed nodes and settles the difference), never a re-layout.
			this.scheduleData();
			this.emitSceneChanged();
			return;
		}
		if (patch.zBasis !== undefined && patch.zBasis !== prev.zBasis && this.labelAsZ) this.nodeRebuildPending = true;
		if (patch.labelAsZ !== undefined && patch.labelAsZ !== prev.labelAsZ) {
			this.nodeRebuildPending = true; // the chip text changes → re-run the shape factory for every node
			this.scheduleData();
			this.emitSceneChanged();
			return;
		}
		// Tear the boxes down at once when grouping turns off or its axis changes; the next geometry pass draws the new set.
		if ((patch.grouped !== undefined && !this.groupingActive()) || patch.groupBy !== undefined) this.enclosureCtl.clearEnclosures();
		this.relayout();
		this.emitSceneChanged();
	}

	override render(): TemplateResult {
		const legend = this.renderType.axisLegend();
		// The orbit compass is a minimal wire XYZ indicator in the upper-left, transparent to pointer events. The axis legend
		// shows only where the layout gives the axes meaning (gantt: x is the time span, y the task rows). The canvas is pinned
		// to the column box and clipped: A-Frame may size its buffer larger, but it never overflows or pushes scrollbars, and
		// the frame loop keeps the buffer and camera matched to this box without stretch or blur. Its stacking is set as well as
		// its position: the VR library treats its scene as fullscreen and gives the canvas a z-index of its own, which painted
		// it over every control on the page, the graph column's own header among them. The guide is visually hidden until a
		// keyboard reader tabs into it or the head's 🧭 opens it, then a readable overlay panel: a focused entry is visible
		// (WCAG focus visible), not clipped away, and both ways in land on one shown state. A reading is a document: its text
		// selects and copies by hand, and each entry is also the way to its node, so it is written as a link is, underlined in
		// the accent. A list's marker is drawn in its left padding, which, sized in em, holds three digits at any size.
		return html`
			<style>
				shu-graph-scene { display: contents; }
				shu-graph-scene #polymorphic-info { position: absolute; bottom: var(--shu-space-5); left: var(--shu-space-5); z-index: 12; max-width: 70%; min-height: 20px; background: var(--shu-bg-elevated); padding: var(--shu-space-3) var(--shu-space-4); border-left: 3px solid var(--shu-accent); border-radius: var(--shu-radius); font-family: var(--shu-mono, monospace); font-size: var(--shu-font-sm); color: var(--shu-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				shu-graph-scene #polymorphic-info[hidden] { display: none; }
				shu-graph-scene #polymorphic-compass { position: absolute; top: var(--shu-space-5); left: var(--shu-space-5); width: 72px; height: 72px; z-index: 9; pointer-events: none; opacity: 0.9; }
				shu-graph-scene #polymorphic-axis-legend { position: absolute; top: var(--shu-space-5); right: var(--shu-space-5); z-index: 10; pointer-events: none; background: var(--shu-bg-elevated); padding: var(--shu-space-2) var(--shu-space-4); border-right: 3px solid var(--shu-accent); border-radius: var(--shu-radius); font-family: var(--shu-mono, monospace); font-size: var(--shu-font-sm); color: var(--shu-fg); }
				shu-graph-scene #polymorphic-axis-legend .axis-row { display: flex; gap: var(--shu-space-2); align-items: baseline; }
				shu-graph-scene #polymorphic-axis-legend .axis-key { color: var(--shu-fg-muted); min-width: 3.5em; }
				shu-graph-scene #polymorphic-canvas { position: absolute; inset: 0; overflow: hidden; }
				shu-graph-scene #polymorphic-canvas a-scene, shu-graph-scene #polymorphic-canvas canvas { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; z-index: 0 !important; display: block; }
				shu-graph-scene #polymorphic-a11y { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
				shu-graph-scene #polymorphic-a11y button { user-select: text; background: none; border: 0; padding: 0; margin: 0; font: inherit; text-align: left; color: var(--shu-accent); text-decoration: underline; cursor: pointer; }
				shu-graph-scene #polymorphic-a11y button:hover, shu-graph-scene #polymorphic-a11y button:focus-visible { text-decoration-thickness: 2px; }
				shu-graph-scene #polymorphic-a11y button[aria-current="true"] { font-weight: 600; }
				shu-graph-scene #polymorphic-a11y ol { margin: 0; padding-left: 3em; }
				shu-graph-scene #polymorphic-a11y ul { margin: 0 0 var(--shu-space-1); padding-left: var(--shu-space-4); list-style: none; opacity: 0.85; }
				shu-graph-scene #polymorphic-a11y > div > ul { padding-left: 0; opacity: 1; }
				shu-graph-scene #polymorphic-a11y[data-shown] { user-select: text; }
				shu-graph-scene #polymorphic-a11y:focus-within, shu-graph-scene #polymorphic-a11y[data-shown] { width: auto; height: auto; clip-path: none; top: var(--shu-space-5); left: var(--shu-space-5); max-width: 70%; max-height: 80%; overflow: auto; z-index: 13; background: color-mix(in srgb, var(--shu-bg-elevated) 82%, transparent); backdrop-filter: blur(6px); padding: var(--shu-space-3) var(--shu-space-4); user-select: text; border-left: 3px solid var(--shu-accent); border-radius: var(--shu-radius); font-size: var(--shu-font-sm); color: var(--shu-fg); }
			</style>
			<div id="polymorphic-info" data-testid="polymorphic-info" hidden></div>
			<div id="polymorphic-canvas" data-testid=${SHU_TEST_IDS.POLYMORPHIC_VIEW.GRAPH_CONTAINER} aria-hidden="true"></div>
			<nav id="polymorphic-a11y" data-testid=${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y} aria-label="graph guide" ?data-shown=${this.config.readAsDocument}></nav>
			<canvas id="polymorphic-compass" aria-hidden="true"></canvas>
			${
				legend
					? html`<div id="polymorphic-axis-legend" data-testid=${SHU_TEST_IDS.POLYMORPHIC_VIEW.AXIS_LEGEND}>
							<div class="axis-row"><span class="axis-key">time</span><span>${legend.from} → ${legend.to}</span></div>
							<div class="axis-row"><span class="axis-key">rows</span><span>${legend.count} tasks</span></div>
						</div>`
					: ""
			}
		`;
	}

	protected override async onConnected(): Promise<void> {
		await this.updateComplete;
		// The scene's timers and frames end with it, before the teardowns below release what they read.
		this.#parts.begin();
		this.autoTeardown(() => this.#parts.end());
		this.forcegraphEl = undefined;
		this.infoEl = this.querySelector("#polymorphic-info");
		this.compassEl = this.querySelector<HTMLCanvasElement>("#polymorphic-compass");
		if (this.compassEl) {
			const dpr = window.devicePixelRatio;
			this.compassEl.width = Math.round(72 * dpr);
			this.compassEl.height = Math.round(72 * dpr);
		}

		const container = this.querySelector<HTMLElement>("#polymorphic-canvas");
		if (!container) throw new Error("shu-graph-scene: #polymorphic-canvas not found");

		// A served page reads troika's lookup of a character the label font lacks at an address absolute on its own. A page that
		// carries a record of actuality, which a site doesn't serve, reads the font it carries.
		const address = pageAddress();
		configureLabelFonts(address === undefined ? carriedLabelFont() : { fallbacks: new URL(LABEL_FONT_FALLBACKS, address).href });
		const VR = ForceGraphVR as unknown as new (el: HTMLElement) => FGInstance;
		// The library builds its scene while the canvas holder is out of the page, so A-Frame reads the attributes set here as
		// it attaches the scene.
		const holder = container.parentNode;
		if (!holder) throw new Error("shu-graph-scene: #polymorphic-canvas is detached");
		const following = container.nextSibling;
		container.remove();
		this.graph = new VR(container);
		const scene = container.querySelector<TSceneElement>("a-scene");
		if (!scene) throw new Error("shu-graph-scene: the graph library didn't make an a-scene");
		// A-Frame's loading screen draws on a loop of its own, started on a timer, which would draw after a scene that ends
		// before it loads; the scene draws its own state, so it doesn't show one.
		scene.setAttribute("loading-screen", "enabled: false");
		// The VR lib sets embedded="" (falsy), so A-Frame's own resize() repeatedly sizes the canvas/camera to
		// document.body and clobbers the fit. A truthy value makes A-Frame size to the embedding element instead.
		scene.setAttribute("embedded", "true");
		scene.setAttribute("data-testid", SHU_TEST_IDS.POLYMORPHIC_VIEW.SCENE);
		// Plain HTTP (without a secure context, e.g. http://<host>: dev): WebXR and the device sensors can't be granted, so
		// don't offer VR at all: don't show an enter-VR button or an A-Frame "use HTTPS" alert. HTTPS keeps the full XR UI.
		if (!window.isSecureContext) {
			scene.setAttribute("device-orientation-permission-ui", "enabled: false");
			scene.setAttribute("xr-mode-ui", "enabled: false");
		}
		holder.insertBefore(container, following);
		// The gate on the renderer's loop exists from the scene's creation, so a scene that ends before its first frame stops
		// A-Frame's loop as A-Frame installs it, and the end stops the loop before the renderer is released.
		const frameTime = this.#parts.frameTime(() => scene.renderer?.getContext?.() as TFenceGl | undefined, DEFAULT_REGULATION_THRESHOLDS.windowSamples);
		const drawing = this.#parts.frameLoop(scene, () => frameTime.drew());
		this.drawing = drawing;
		this.configureGraph(this.graph);
		// One draw, two media: WebGL shows the graph, the accessible document reads it. The a11y entries drive the same
		// scene entries a pointer does (activate opens, focus highlights), so keyboard and pointer take one path.
		this.#reading = new A11yRenderer({
			region: () => this.querySelector<HTMLElement>("#polymorphic-a11y"),
			bars: () => this.actorBars(),
			labelOf: (n) => this.chipLabelOf(n, this.markFor(n)),
			marks: () => ({ active: this.activeSubject, tierOf: this.focusCtl.tierOf(), pinned: (id) => this.userPins.has(id) }),
			groups: () => (this.groupingActive() ? [...groupTitles(this.nodeMap.values(), this.groupBy, roleNounFor).values()] : []),
			onActivate: (id) => this.openNode(id),
			onFocus: (id) => this.setHoveredNode(id),
		});
		this.renderer ??= compositeRenderer(
			threeRenderer(this.graph, (n) => this.nodeObject(n)),
			this.#reading,
		);
		this.renderer.rebuildNodes(); // the node factory reaches the library through the renderer, initially and on every shape change
		this.cameraCtl.fitFrame(container);

		this.autoTeardown(() => {
			drawing.end();
			frameTime.end();
			// The scene's clock cancelled the timers these name, so a scene connected again schedules its own.
			this.repaintTimer = undefined;
			this.layoutTimer = undefined;
			this.cameraCtl.end();
			this.ganttOverlay.dispose();
			this.enclosureCtl.dispose(); // boxes + the shared unit geometries (the gantt ghost reuses unitEdges but never disposes it)
			// Release the scene's WebGL context deterministically: a context otherwise frees only at GC, and past the
			// browser's concurrent-context cap the OLDEST context is silently lost, closed views must never be able to
			// take a live view's context with them. The renderer exists from the scene's attach, so a scene that ends
			// before it loads releases it too.
			scene.renderer?.dispose?.();
			scene.renderer?.forceContextLoss?.();
		});

		this.autoListen(scene, "loaded", () => this.onSceneLoaded(scene, container, drawing, frameTime), { once: true });
	}

	/** Hand a node off to its @type presenter for a backend-neutral mark: the single place the calendar placement (the
	 *  bar's span) becomes presenter context. nodeObject paints it, and the reading names it as its chip reads. */
	private markFor(n: FGNode): NodeMark {
		const t = this.renderType.markTime(n.id); // the active view's calendar context for the presenter (a gantt bar's span); undefined → a point-in-time chip
		return presentationForType(n.type).mark(n, t ? { time: t } : {});
	}

	/** Build a node's 3D object: hand the node off to its @type presenter for a backend-neutral mark, then paint it for
	 *  the polymorphic view. The presenter chooses shape/colour/label/role; this view supplies only the medium config. */
	private nodeObject(n: FGNode): unknown {
		const three = aframeThree();
		if (!three) throw new Error("shu-graph-scene: a node's object is built from A-Frame's THREE, which this page doesn't hold");
		const mark = this.markFor(n);
		// The common instance node (a "chip") renders as an SDF glyph-atlas chip (troika), dark text on a solid
		// type-coloured background, all labels sharing one atlas texture and one background geometry, so a node doesn't take
		// a per-node canvas raster + GPU texture upload; a schema Class's square token is a chip too. The gantt box and the
		// ontology lozenge are painted, the box carrying its troika label as a child. The billboard frame job keeps every
		// label facing the camera. fontSize is the WORLD text height (chipTextHeight).
		// "Label as z factor" labels each chip with the value that places its depth: the date under a time basis, the
		// connection count under connections, so the z factor reads straight off the graph. Off (or without a value), the usual label.
		const chipLabel = this.chipLabelOf(n, mark);
		// Every mark is built highlight-capable and the FOCUS pass glows the active node (visual.setHighlighted), so
		// the highlight follows the selection without rebuilding a single object. A drag-pin doesn't carry a highlight: a
		// pin is a position the reader chose, not a state to advertise, and the pin set persists across queries, so
		// highlighting pins would mark nodes unrelated to what is being read.
		const visual =
			mark.kind === "chip" || mark.kind === "square"
				? makeTroikaChip(chipLabel, mark.color, three, {
						fontSize: chipTextHeight(mark),
						renderOrder: NODE_RENDER_ORDER,
						textColor: this.chipTextColor,
						borderColor: NODE_BORDER_COLOR,
						highlightColor: this.activeHighlightColor,
						avatar: typeAvatar(mark.type),
						laidOut: () => this.markDirty("label"),
					})
				: spriteVisual(
						paintMarkScene(mark, {
							three,
							makeLabel: (text, h, color, anchor) => makeTroikaText(text, { fontSize: h, color, renderOrder: NODE_RENDER_ORDER, anchor, emphasis: false }),
							textColor: this.chipTextColor, // on a chip: dark on the light type colour
							sceneTextColor: this.sceneTextColor, // off a chip (box label): foreground on the scene bg
							borderColor: NODE_BORDER_COLOR,
							renderOrder: NODE_RENDER_ORDER,
							headerLabel: this.renderType.capsNodeLabels,
						}),
						{ three, color: this.activeHighlightColor, renderOrder: NODE_RENDER_ORDER - 1 },
					);
		const obj = visual.object;
		n.__visual = visual;
		visual.setHighlighted(n.id === this.activeSubject, FULL_BURN); // a rebuilt object re-wears the glow if it is the active node
		n.__baseScale = { x: obj.scale.x, y: obj.scale.y };
		n.__k = 1;
		// A visual built after the focus was applied wears it from the next pass at rest, however late the library builds it.
		if (this.hoverSubject || this.selectedSubject) this.requestFocusAtRest();
		return obj;
	}

	/** What a node's chip reads: the value that places its depth where chips are labelled by it, else its mark's label. */
	private chipLabelOf(n: FGNode, mark: NodeMark): string {
		const label = (this.labelAsZ ? this.zFactor(n).chip : undefined) ?? mark.label;
		return withAxioms(label, this.axioms?.nodes.get(n.id));
	}

	/** What an edge's label reads: its predicate, and the axioms of its property in the DL view. */
	private edgeLabelOf(l: FGLink): string {
		return withAxioms(l.predicate, this.axioms?.edges.get(linkKey(l)));
	}

	/** The DL view's axioms on the nodes and edges the scene draws, or null to draw them without. The chips and the edge
	 *  labels read them, so the same nodes and edges stay in place and only their text changes. */
	setAxioms(axioms: TAxiomOverlay | null): void {
		this.axioms = axioms;
		for (const l of this.currentLinks) if (l.__label) l.__label.text = this.edgeLabelOf(l);
		this.nodeRebuildPending = true; // the chip text changes → re-run the shape factory for every node
		this.scheduleData();
	}

	/** Whether what the scene shows still changes: something moves or is drawn, a repaint or a relayout is scheduled, the
	 *  camera hasn't rested, a newcomer's welcome is still to end, or a chip's text is still to land. */
	private changing(reason: TDrawingReason): boolean {
		if (reason !== "rest" || this.repaintTimer !== undefined || this.layoutTimer !== undefined || this.cameraCtl.pending || this.focusCtl.welcoming > 0) return true;
		for (const n of this.nodeMap.values()) if (n.__visual?.layingOut) return true;
		return false;
	}

	/** Orient the node visuals to face the camera (each visual billboards itself: a troika chip group turns, a native
	 *  sprite is a no-op). Runs every frame (without a camera-turn guard): troika builds a chip's geometry on a LATER frame than
	 *  its graphData feed, so a guarded pass would leave a just-built chip in its default orientation until the next camera
	 *  turn: the tilted-label bug. The work is one in-place quaternion copy per chip (without an allocation: the earlier drag lag
	 *  was a per-frame ALLOCATION here, since removed); nodeMap is the live set, so a separate registry doesn't leak. */
	private billboardLabels(): void {
		const q = this.fgCamera?.quaternion;
		if (!q) return;
		for (const n of this.nodeMap.values()) n.__visual?.faceCamera(q);
		for (const l of this.currentLinks) l.__label?.faceCamera(q);
		for (const label of this.enclosureCtl.labels()) label.faceCamera(q);
		for (const label of this.ganttOverlay.labels()) label.faceCamera(q);
	}

	private configureGraph(g: FGInstance): void {
		g.nodeLabel((n) => n.name)
			// The lib derives line opacity from the global linkOpacity × the colour's alpha and pools materials by
			// colour: so focus dim/highlight is carried ENTIRELY in the rgba the accessor returns (see lineRgbaFor). Global
			// opacity is 1 so the per-edge alpha is the sole driver; re-calling linkColor on focus change re-pools
			// without rebuilding objects or reheating the layout. It doesn't hold mesh handles or clone a material per link.
			.linkColor((l) => this.focusCtl.lineRgbaFor(l))
			.linkOpacity(1)
			.linkWidth(0.5)
			.linkCurvature(0.25)
			.linkDirectionalParticleWidth(1.8)
			.linkDirectionalParticleColor(() => this.particleColor)
			// A persistent arrowhead marks each edge's direction; its colour comes from lineRgbaFor so it dims/highlights with
			// the line under focus (re-pooled alongside linkColor in applyFocus).
			.linkDirectionalArrowLength(ARROW_LENGTH)
			.linkDirectionalArrowRelPos(ARROW_REL_POS)
			.linkDirectionalArrowColor((l) => this.focusCtl.lineRgbaFor(l))
			.linkThreeObjectExtend(true)
			.linkThreeObject((l) => {
				const label = makeTroikaText(this.edgeLabelOf(l), {
					fontSize: EDGE_LABEL_TEXT_HEIGHT,
					color: this.edgeLabelColor,
					renderOrder: EDGE_LABEL_RENDER_ORDER,
					anchor: { x: "center", y: "middle" },
					emphasis: false,
				});
				l.__label = label;
				return label.object;
			})
			.linkPositionUpdate((obj, { start, end }, link) => {
				const sprite = obj as Obj3D;
				// The lib sets the link GROUP's renderOrder to 10, and three.js uses a group's renderOrder as the
				// children's groupOrder, the PRIMARY sort key, so links would always paint over the node chips
				// (groupOrder 0) whatever the sprites' own flags state. Zero it; the secondary renderOrder then
				// layers line (0) → edge label (15) → node chip (20), back to front.
				if (sprite.parent && sprite.parent.renderOrder !== 0) sprite.parent.renderOrder = 0;
				const mid = link.__curve ? link.__curve.getPoint(0.5) : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 };
				sprite.position.set(mid.x, mid.y, mid.z);
			})
			.onEngineStop(() => {
				const cameToRest = this.#parts.engine.engineStopped(); // the governor records that the engine rests
				this.cameraCtl.camera.autoFitOnSettle(this.#parts.tween.running); // keep the spreading graph framed (growth-gated); the controller owns the policy
				// Release the temporary data-feed pins now the settle has come to rest: existing nodes held still
				// through the reheat (without jitter), and the resting layout is not left permanently frozen.
				for (const id of this.dataPinnedIds) {
					const n = this.nodeMap.get(id);
					if (n) {
						n.fx = undefined;
						n.fy = undefined;
					}
				}
				this.dataPinnedIds = [];
				// Re-assert an active focus at rest: a focus applied DURING the settle is skipped by the focus controller's
				// settle guard (dimming an under-converged layout would pin it mid-motion), so the resting frame applies it.
				// Only a stop that ended motion: applying the focus re-pools linkColor, which restarts the lib's countdown
				// and reports another stop at rest, and re-asserting on that stop would keep the scene drawing.
				if (cameToRest && (this.hoverSubject || this.selectedSubject)) this.requestFocusAtRest();
				// After a data settle (not a layout solve: those tween independently), draw enclosures and run the settle
				// hook (queued re-aim + gantt ruler) on the frame the nodes came to rest, not while they were still moving.
				if (!this.#parts.tween.running) {
					if (this.groupingActive()) this.#parts.clock.frame(() => this.enclosureCtl.updateEnclosureGeometry());
					this.onLayoutSettled();
				}
			})
			.showNavInfo(false) // its "Mouse drag: look" text describes the controls this replaced
			.numDimensions(2) // matches the scene's own 2D placement; the lib sim doesn't have forces, so it never sets positions
			.warmupTicks(0) // the digest doesn't block the main thread synchronously, placement already ran (layoutForFeed)
			.cooldownTicks(120)
			// Node clicks are handled by the scene's canvas click listener via pickNodeAt (the same authoritative press-time
			// pick the drag uses), NOT the lib's onNodeClick: that raycaster fires unreliably (and a stale post-drag
			// click capture made it miss after several focus switches). One reliable pick, without a capture flag.
			.onNodeHover((n) => {
				// Phantom-hover guards: during a layout tween, a drag, or a data-feed SETTLE, nodes pass UNDER the cursor
				// (the graph is still moving); and when the pointer isn't over the canvas at all, the cursor raycasts a
				// stale position every frame. All would jump focus to nodes the user never pointed at, honor hover only
				// from a live pointer over a graph at rest. (The programmatic setHoveredNode test interface is NOT gated.)
				if (this.#parts.tween.running || this.pick.drag.dragging || !this.pick.pointerOver || this.#parts.engine.mode === "settling") return;
				this.hoverSubject = n?.id ?? null;
				this.updateHoverInfo(n ?? null);
				this.applyFocus();
			})
			// An edge under the pointer states what is behind it, under the guards a node's hover takes; choosing one is the
			// host's to act on, as a host shows the lines that state it.
			.onLinkHover((l) => {
				if (this.#parts.tween.running || this.pick.drag.dragging || !this.pick.pointerOver || this.#parts.engine.mode === "settling") return;
				this.showInfo(l === null ? null : this.linkInfo(l));
			})
			.onLinkClick((l) => this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.EDGE_CHOSEN, { detail: { key: linkKey(l) }, bubbles: true, composed: true })));
	}

	/**
	 * The scene's own placement for this feed. A fresh layout each time, because d3 caches each force's accessor at
	 * initialize: the anchors and lane targets refresh only through re-registration. z is assigned from data in
	 * toGraphData: the time axis in gantt, the recorded-time depth otherwise.
	 */
	private layoutForFeed(): IGraphLayout {
		return forceLayout({
			grouped: this.groupingActive(),
			suppressesGrouping: this.renderType.suppressesGrouping, // a lane view owns positions, so the link springs relax
			groupBy: this.groupBy,
			anchors: this.enclosureCtl.anchors,
			nodeMap: this.nodeMap,
			lanePlacement: (id) => this.renderType.lanePlacement(id),
		});
	}

	/**
	 * Remove the library simulation's forces, so its ticks only move sprites: a pinned node tracks its pin, an unpinned
	 * one doesn't have velocity and stays put. The layout places the nodes before the feed (layoutForFeed), never the
	 * library: which is what lets any renderer display the same positions.
	 */
	private removeLibraryForces(): void {
		for (const name of ["link", "charge", "center"]) this.graph?.d3Force(name, null);
	}

	/** What a node's depth encodes, in one place so the hover overlay and the "label as z factor" chip can't disagree:
	 *  under the connections basis its degree; otherwise its time, labelled by the FIELD __t came from (dateReceived,
	 *  dateModified, generatedAtTime). `display` is the full hover form; `chip` is the compact chip form (undefined = fall
	 *  back to the name). */
	private zFactor(n: FGNode): { display: string; chip: string | undefined } {
		if (this.config.zBasis === "connections") {
			// The pipeline counts a node's degree on the feed under this basis; a node built before that feed shows its name.
			if (n.__degree === undefined) return { display: "connections aren't counted yet", chip: undefined };
			return { display: `${n.__degree} connections`, chip: `${n.__degree}` };
		}
		// The pipeline sets the time and the field it came from together, from the same subject time.
		if (n.__t === undefined || n.__tField === undefined) return { display: "time isn't recorded", chip: undefined };
		const date = formatInstant(new Date(n.__t).toISOString(), new Date(), readerZone());
		return { display: `${n.__tField} ${date}`, chip: date };
	}

	/** Essentials for the node under the pointer, overlaid above the controls: its label · its type · what its depth encodes. */
	private updateHoverInfo(n: FGNode | null): void {
		if (!n || n.isCluster) return this.showInfo(null);
		// Ontology terms are timeless, so the z/time factor is meaningless for them: show the vocabulary that declares a Property
		// (haibun's own vs a standard's prefix) and whether the type's data uses it, in place of the time.
		this.showInfo(isSchemaType(n.type) ? schemaHoverText(n) : `${n.name} · ${n.type} · ${this.zFactor(n).display}`);
	}

	/** An edge as a hover states it: its ends and its predicate. */
	private linkInfo(l: FGLink): string {
		const nameOf = (end: string | FGNode): string => this.nodeMap.get(linkEndId(end))?.name ?? linkEndId(end);
		return `${nameOf(l.source)} ${l.predicate} ${nameOf(l.target)}`;
	}

	/** Shows `text` overlaid above the controls, or hides the overlay. */
	private showInfo(text: string | null): void {
		const el = this.infoEl;
		if (!el) return;
		el.hidden = text === null;
		if (text !== null) el.textContent = text;
	}

	/** Re-bind the node-three-object accessor with a fresh reference so three-forcegraph drops its cached __threeObj and
	 *  rebuilds EVERY node object on the next graphData feed: the only way the lib re-runs the shape factory for nodes
	 *  it already holds. Called when a node's shape changed without its identity (see nodeRebuildPending). */
	private forceNodeObjectRebuild(): void {
		this.renderer?.rebuildNodes();
		this.nodeRebuildPending = false;
	}

	/** Record the gantt bar-width fingerprint; a change (span/duration/task-set) means every box must be rebuilt. */
	private setGanttShapeSig(sig: string): void {
		if (sig === this.ganttShapeSig) return;
		this.ganttShapeSig = sig;
		this.nodeRebuildPending = true;
	}

	/** A gantt bar dragged along the time axis: map its new centre z back to a start/end (preserving its duration), then
	 *  emit the reschedule for the host to persist and refetch. Reschedules the bar AND every task that depends on it by
	 *  the same delta. No-op outside gantt or for a node that isn't a placed task. */
	private commitGanttDrag(node: FGNode): void {
		const target = this.ganttTargets.get(node.id);
		const scale = this.ganttScale;
		if (!this.renderType.dragReschedules || !target || !scale || node.z === undefined || node.isCluster) return;
		const tasks = quadsToGanttModel(this.pipeline.renderableQuads(), relationOfPredicate).tasks;
		const dragged = tasks.find((t) => t.id === node.id);
		if (!dragged) return;
		// Time is the z axis: the dropped bar's new centre z maps back to its start (ganttBarSpan is the 1D inverse). The
		// drag sets node.z directly (the 2D sim ignores fz), so read z: the bar's actual rendered position.
		const newStartMs = ganttBarSpan(node.z, target.zLen, scale).start;
		// Dragging a bar reschedules it AND slides every task that depends on it by the same delta.
		const shifted = cascadeReschedule(node.id, newStartMs - dragged.start, tasks);
		const updates: RescheduleUpdate[] = [...shifted].map(([id, { start, end }]) => ({
			label: node.type,
			id,
			data: { startedAtTime: new Date(start).toISOString(), endedAtTime: new Date(end).toISOString() },
		}));
		if (updates.length === 0) return;
		// The host persists each vertex + refetches, then calls flushRepaint() so the rescheduled bars redraw at once.
		this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.RESCHEDULE_REQUEST, { detail: { updates }, bubbles: true, composed: true }));
	}

	/** Cancel the queued streamed-data repaint and repaint now: the host calls this after a reschedule's refetch lands so
	 *  the rescheduled bars and their edges redraw immediately rather than after the trailing coalesce. */
	flushRepaint(): void {
		if (this.repaintTimer !== undefined) {
			this.repaintTimer();
			this.repaintTimer = undefined;
		}
		this.repaint();
	}

	private onSceneLoaded(scene: TSceneElement, container: HTMLElement, drawing: TGraphFrameLoop, frameTime: TGraphFrameTime): void {
		// Attach the governor to the INNER three-forcegraph instance: its pacing props apply synchronously, where the VR
		// wrapper forwards them through two debounced digests (a cooldown set from inside the engine's stop callback would
		// land frames late and the engine would re-stop on the stale value).
		const fgEl = scene.querySelector("[forcegraph]") as TForcegraphElement | null;
		const inner = fgEl?.components?.forcegraph?.forceGraph;
		if (!fgEl || !inner) throw new Error("shu-graph-scene: inner forcegraph instance unavailable at scene load");
		this.#parts.engine.attach(inner);
		this.forcegraphEl = fgEl;
		// Named after load, since A-Frame may swap in its own camera entity during scene init.
		scene.querySelector("[camera]")?.setAttribute("data-testid", SHU_TEST_IDS.POLYMORPHIC_VIEW.CAMERA);
		this.startFrameLoop(scene, this.cameraCtl.attach(scene), drawing, frameTime);
		this.removeLibraryForces();
		this.applyTheme();
		// Own the size end-to-end: the lib's wrapper frame (fitGraphFrame) plus the drawing buffer + camera. A genuine
		// resize takes the fov-preserving path (onContainerResize); the rAF watchdog re-asserts aspect-only
		// (syncViewport) so an A-Frame body-sized resize can't persist OR slip in a zoom.
		this.fgRenderer = scene.renderer;
		this.fgCamera = scene.camera;
		this.fgCanvas = container.querySelector("canvas") ?? undefined;
		this.fgContainer = container;
		this.fgSceneEl = scene;
		if (this.fgCanvas === undefined) throw new Error("shu-graph-scene: the scene lacks the canvas a pick reads");
		this.pick.attach(scene, this.fgCanvas);
		this.cameraCtl.fitFrame(container);
		this.cameraCtl.camera.onContainerResize();
		this.#observers.resizes(container, () => {
			this.markDirty("resize"); // a paused scene must wake to re-fit and redraw on a container resize
			this.cameraCtl.fitFrame(container);
			this.cameraCtl.camera.onContainerResize();
		});
		// Re-theme when the OS colour scheme flips (auto mode) or the user picks a theme (data-theme on <html>).
		this.#observers.mediaChanges("(prefers-color-scheme: dark)", () => this.applyTheme());
		this.#observers.attributes(document.documentElement, ["data-theme"], false, () => this.applyTheme());
		// An overlay declaring that it covers the views: a framing aims clear of it while it is there, and back over the
		// whole canvas once it goes.
		this.#observers.attributes(document.body, [SHU_ATTR.DATA_COVERS_VIEWS], true, () => this.cameraCtl.coverChanged());
	}

	/**
	 * The lib wraps the scene in its own position:relative div sized by its width/height props, which DEFAULT TO
	 * WINDOW SIZE: the scene then displays at that size regardless of the column (the measured stretch/blur).
	 * Keep that frame matched to the column via the lib's own width()/height() API.
	 */
	/**
	 * Light geometry watchdog, sampled every 15 frames from the rAF tick (per-frame layout reads would force a
	 * synchronous layout flush 60×/s for the component's lifetime). Re-asserts the buffer size aspect-only via
	 * syncViewport (an A-Frame body-sized resize must not persist), NEVER the fov-preserving resize path, so it
	 * cannot rescale the graph, and refreshes the cursor's cached pick bounds when the canvas merely MOVES, strip
	 * scrolled sideways, a column opened/closed, the actions bar, which doesn't fire ResizeObserver (size
	 * unchanged) or A-Frame's window listeners (inner scroller). Integer-pixel comparison so subpixel layout jitter
	 * doesn't refresh in a loop. Real container resizes are handled immediately by the ResizeObserver (the fov path).
	 */
	private checkCanvasGeometry(): void {
		this.cameraCtl.camera.syncViewport();
		// What the canvas shows is the same wherever it is on the page, so a move only refreshes the pick bounds, and a scene
		// at rest stays at rest; a changed size is drawn again at its new aspect.
		if (this.pick.canvasResized()) this.markDirty("resize");
	}

	private themeColor(token: string, fallback: string): string {
		const v = getComputedStyle(this).getPropertyValue(token).trim();
		return v || fallback;
	}

	/** A theme length token in px. A custom property holds the token's text (`calc(13px * var(--shu-scale))`), which only a
	 *  property that takes a length resolves, so a probe's computed font-size reads it as the page draws it. */
	private themeLengthPx(token: string): number {
		const probe = this.ownerDocument.createElement("span");
		probe.style.fontSize = `var(${token})`;
		this.append(probe);
		const px = Number.parseFloat(getComputedStyle(probe).fontSize);
		probe.remove();
		if (Number.isNaN(px)) throw new Error(`theme token ${token} doesn't resolve to a length; the shu theme styles supply it`);
		return px;
	}

	/**
	 * Wire orbit compass: projects the three world axes (x, y, t=time/z) through the live camera orientation
	 * and draws them on the small upper-left canvas. Back-facing axes render as faint dashes; front-facing as
	 * solid lines with dots. matrixWorld columns (col-major): right=[0,1,2], up=[4,5,6], back=[8,9,10].
	 * Screen: sx = dot(axis, right), sy = -dot(axis, up) [Y flipped]; depth = -dot(axis, back).
	 */
	private drawCompass(): void {
		const canvas = this.compassEl;
		const m = this.ctx.camera?.matrixWorld?.elements;
		if (!canvas || !m || canvas.width === 0) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const dpr = window.devicePixelRatio;
		const W = canvas.width / dpr;
		const H = canvas.height / dpr;
		ctx.save();
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, W, H);
		const cx = W / 2;
		const cy = H / 2;
		const R = W * 0.28; // shorter axis length: room for labels within the canvas without a backdrop disc
		const { compassFgColor: fgColor, compassAccentColor: accentColor, compassDimColor: dimColor } = this;
		// Drop shadow makes lines and labels read on any scene colour without a filled background
		ctx.shadowColor = "rgba(0,0,0,0.75)";
		ctx.shadowBlur = 3;
		// depth sort: back axes paint first so front ones always read on top
		const axes = [
			{ sx: m[0], sy: -m[1], depth: -m[2], label: "x", color: fgColor },
			{ sx: m[4], sy: -m[5], depth: -m[6], label: "y", color: fgColor },
			{ sx: m[8], sy: -m[9], depth: -m[10], label: "t", color: accentColor },
		].sort((a, b) => a.depth - b.depth);
		for (const ax of axes) {
			const toward = ax.depth > 0;
			// Negative half: short dashed tick in the dim colour
			ctx.globalAlpha = toward ? 0.3 : 0.6;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(cx - ax.sx * R * 0.55, cy - ax.sy * R * 0.55);
			ctx.strokeStyle = dimColor;
			ctx.lineWidth = 0.75;
			ctx.setLineDash([2, 3]);
			ctx.stroke();
			ctx.setLineDash([]);
			// Positive direction
			ctx.globalAlpha = toward ? 1 : 0.4;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(cx + ax.sx * R, cy + ax.sy * R);
			ctx.strokeStyle = ax.color;
			ctx.lineWidth = toward ? 1.5 : 0.75;
			ctx.stroke();
			// Tip dot
			ctx.beginPath();
			ctx.arc(cx + ax.sx * R, cy + ax.sy * R, toward ? 2.5 : 1.5, 0, Math.PI * 2);
			ctx.fillStyle = ax.color;
			ctx.fill();
			// Label just beyond the tip
			ctx.globalAlpha = toward ? 1 : 0.3;
			ctx.fillStyle = ax.color;
			ctx.font = "bold 11px monospace";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(ax.label, cx + ax.sx * (R + 11), cy + ax.sy * (R + 11));
		}
		ctx.restore();
	}

	/** Pull the scene background + edge colours from the live theme tokens. */
	private applyTheme(): void {
		this.edgeLabelColor = this.themeColor("--shu-fg-muted", "#555555");
		this.edgeLineColor = this.themeColor("--shu-fg-faded", "#888888");
		this.chipTextColor = this.themeColor("--shu-fg-on-swatch", NODE_TEXT_COLOR); // dark on the light type-colour chips
		this.sceneTextColor = this.themeColor("--shu-fg", "#e6e6e6"); // foreground on the scene bg (gantt bar text)
		// A glow is light on a surface, so which ramp it burns through depends on the surface: --shu-invert is the theme's
		// own dark signal (1 in dark), the same one the embedded-document inversion reads.
		this.glowRamp = this.themeColor("--shu-invert", "0") === "1" ? GLOW_RAMP.dark : GLOW_RAMP.light;
		this.focusEdgeColor = this.themeColor("--shu-fg", "#222222");
		this.particleColor = this.themeColor("--shu-accent", "#1a6b3c");
		this.focusTextPx = this.themeLengthPx("--shu-font-md");
		this.compassFgColor = this.themeColor("--shu-fg", "#e0e0e0");
		this.compassAccentColor = this.themeColor("--shu-accent", "#4ac080");
		this.compassDimColor = this.themeColor("--shu-fg-faded", "#666");
		this.graph?.backgroundColor(this.themeColor("--shu-bg", "#ffffff"));
		this.graph?.linkColor((l) => this.focusCtl.lineRgbaFor(l)); // re-pool line materials under the new theme colours
		this.graph?.linkDirectionalArrowColor((l) => this.focusCtl.lineRgbaFor(l)); // arrows follow the same line rgba
		// Labels keep their construction-time colour; recolour them in place: a graphData re-feed would
		// reheat the layout (and the unchanged-model skip would suppress it anyway, leaving labels bg-on-bg).
		for (const l of this.currentLinks) if (l.__label) l.__label.color = this.edgeLabelColor;
		this.enclosureCtl.recolorLabels(this.edgeLabelColor);
		if (this.focusId) this.applyFocus(); // re-assert focus colours under the new theme
		this.markDirty("theme");
	}

	/** Wake the on-demand render loop for the next `grace` gate ticks, so a discrete change (data, selection, resize,
	 *  theme) is drawn rather than slept through, and name what woke it. A motion keeps the scene drawing on its own
	 *  (see `drawingReason`). */
	private markDirty(cause: TWakeCause, grace?: number): void {
		this.drawingFor.wakes++;
		this.#reading?.busy(true); // a reader waiting for the rest after a change waits for the change to be drawn
		// A discrete change that doesn't name its own grace holds the loop for the frames a plain repaint takes.
		const until = this.rafFrame + (grace === undefined ? DIRTY_GRACE_FRAMES : grace);
		if (until < this.dirtyUntilFrame) return;
		this.dirtyUntilFrame = until;
		this.dirtyCause = cause;
	}

	/** Request that the render loop (re)apply the active focus once the layout is at rest and the node visuals exist.
	 *  `focusDirty` keeps the loop awake until a frozen frame applies it. A node whose visual the library builds after
	 *  that requests it again as it is built (`nodeObject`), so a visual isn't left unfocused. */
	private requestFocusAtRest(): void {
		this.focusDirty = true;
		this.markDirty("focus");
	}

	/** Apply the focus, and have the breath take the glows it set on the next tick, so a change of focus is drawn with its
	 *  glow in one wake rather than a second one a beat later. */
	private applyFocus(): void {
		this.focusCtl.applyFocus();
		this.#reading?.mark();
		this.lastBreathAt = 0;
	}

	/**
	 * Re-assert the focus on the nodes now staged.
	 *
	 * Requested of the render loop for the moment the layout comes to rest, and applied outright as well: a loop that is
	 * paused, or an engine frozen at rest, never reaches that moment, and the nodes a feed just staged would stay lit
	 * and the nodes around the selected one wouldn't dim. Every caller that changes what is focused, or what is there to
	 * focus, calls this.
	 */
	private reassertFocus(): void {
		this.requestFocusAtRest();
		this.applyFocus();
	}

	/** One measured frame time: recorded for actuality, kept in the window, and evaluated against the breath's limit.
	 *  A signal is acted on here (the next beat holds or breathes) and recorded, so actuality can observe the regulation
	 *  and the time behind it. */
	private regulate(timeMs: number, now: number, drew: { calls: number }): void {
		recordFrameTime(this.regulation, timeMs, DEFAULT_REGULATION_THRESHOLDS.windowSamples);
		this.recordBlip(GRAPH_FRAME_BLIP, timeMs, { drawCalls: drew.calls, nodes: this.nodeMap.size });
		const signal = evaluateRegulation(this.regulation, DEFAULT_REGULATION_THRESHOLDS, now);
		if (!signal) return;
		this.recordBlip(GRAPH_REGULATION_BLIP, signal.frameTimeMs, { signal: signal.kind, share: signal.share });
		this.lastBreathAt = 0; // the next tick redraws the glow in its new state
	}

	/** Why the gate draws on tick `frame`: a motion in progress (a drag, a tween, the engine settling, a magnify easing),
	 *  a focus still to apply, or a discrete change within its grace, named by its cause. Rest where these don't hold, so a
	 *  scene draws only while something it shows changes. */
	private drawingReason(frame: number): TDrawingReason {
		if (this.pick.drag.dragging) return "drag";
		if (this.#parts.tween.running) return "tween";
		if (this.#parts.engine.mode !== "frozen") return "settle";
		if (this.focusCtl.magnifying) return "magnify";
		if (this.focusDirty) return "focus";
		return frame < this.dirtyUntilFrame ? this.dirtyCause : "rest";
	}

	/** Record how long the last reason to draw lasted when the reason changes, so a page's drawing time divides by reason. */
	private drawFor(reason: TDrawingReason, now: number): void {
		const was = this.drawingFor;
		if (reason === was.reason) return;
		this.recordBlip(GRAPH_DRAWING_BLIP, now - was.since, { reason, was: was.reason, frames: this.rafFrame - was.frame, wakes: was.wakes });
		this.drawingFor = { reason, since: now, frame: this.rafFrame, wakes: 0 };
	}

	/** Start the scene's frame loop: the frame jobs, and the gate that draws while something moves and rests otherwise. */
	private startFrameLoop(scene: TSceneElement, controls: OrbitControls, drawing: TGraphFrameLoop, frameTime: TGraphFrameTime): void {
		// The frame's jobs, declared with their cadences in one place (see FrameScheduler).
		this.#parts.frame.add("controls", () => controls.update(), EVERY_FRAME);
		this.#parts.frame.add("compass", () => this.drawCompass(), 2);
		this.#parts.frame.add("retarget-magnify", () => this.focusCtl.retargetMagnify(), 15);
		this.#parts.frame.add("magnify", () => this.focusCtl.updateMagnify(), EVERY_FRAME);

		this.#parts.frame.add("billboard", () => this.billboardLabels(), EVERY_FRAME); // troika labels are meshes, orient them to the camera each frame
		this.#parts.frame.add("layout-tween", () => this.updateLayoutTween(), EVERY_FRAME);
		// Track the group containers on a throttled cadence WHILE the layout is settling, so they form and follow the
		// nodes instead of popping in only at full stop (a large graph's settle is otherwise a long wait). Nodes are
		// anchor-seeded with real positions from the first frame, so the frames don't flash at z=0; the final
		// draw still lands on onEngineStop. Skipped once frozen, while a node is being dragged (the drag owns the pins),
		// and when grouping is off.
		this.#parts.frame.add(
			"enclosure-track",
			() => {
				if (this.groupingActive() && this.#parts.engine.mode !== "frozen" && !this.pick.drag.dragging) this.enclosureCtl.updateEnclosureGeometry();
			},
			8,
		);
		// Drawing on demand: the frame jobs run and the scene draws only while something is moving (layout settle, tween,
		// drag, magnify ease, camera damping via the `change` listener), a discrete change is still to be drawn, or a focus
		// is pending. Otherwise `Drawing` pauses the components and stops the renderer's loop, so an idle graph doesn't
		// draw, wherever the pointer rests. The rAF loop below keeps running as a per-frame gate of one
		// comparison, so a change wakes the scene within one frame.
		// What a drawn frame takes is measured after the draw (see `FrameTime`) and read in the gate below, where the
		// regulator sets whether the breath may keep requesting frames.
		const tick = () => {
			this.rafFrame++;
			const now = this.#parts.clock.now();
			// A wake detector, not a render job: the canvas can MOVE (strip scroll, column shift) without resizing, which the
			// observers don't catch, so this light poll runs even while the scene is paused and marks dirty on any geometry change.
			if (this.rafFrame % CANVAS_GEOMETRY_EVERY === 0) this.checkCanvasGeometry();
			const frameTimeMs = frameTime.poll();
			if (frameTimeMs !== undefined) {
				const drew = scene.renderer?.info?.render;
				if (!drew) throw new Error("a frame was measured without a renderer to report what it drew");
				this.regulate(frameTimeMs, now, drew);
			}
			// The active node's breath, on wall time like the geometry poll rather than as a frame job: a job's countdown
			// only advances while the scene is drawing, so a throttled breath stalled whenever the scene settled and then
			// jumped. One node's colour and scale, ten times a second, and the frame it requests is the only one it takes;
			// the scene idles between them. While the regulator has the breath resting, the glow is drawn once and held.
			if (now - this.lastBreathAt >= BREATH_MS) {
				this.lastBreathAt = now;
				if (this.focusCtl.updateHighlight(this.decorates())) this.markDirty("breath", 1);
			}
			// A pending focus keeps the scene awake until it can be applied: applyFocus needs the layout at rest (its pin +
			// sim tick would jump an under-converged graph) and the node visuals built (it skips a node without a visual
			// yet), and either can lag a selection made mid-build. Sleeping before then would leave the dim undrawn.
			const reason = this.drawingReason(this.rafFrame);
			this.drawFor(reason, now);
			this.#reading?.busy(this.changing(reason));
			const active = reason !== "rest";
			drawing.moving(active);
			if (active) {
				if (this.focusDirty && this.#parts.engine.mode === "frozen") {
					this.applyFocus();
					this.focusDirty = false;
				}
				this.#parts.frame.tick();
			}
			this.#parts.clock.frame(tick);
		};
		this.#parts.clock.frame(tick);
	}

	private cursorPaintPending = false;
	/** The time cursor moved (the host has already refreshed model.visibleQuads + model.timeCursor before this call): re-style
	 *  promptly rather than through the streamed-data window, so a scrub isn't laggy. Deferred a tick out of the synchronous
	 *  cursor-notify stack, re-feeding graphData re-entrantly under the setter leaves the lib mid-update (a re-added node
	 *  settles off-frame). First-wins coalesce; the cursor repaint supersedes any queued streamed-data repaint. */
	setTimeCursorValue(_ms: number | null): void {
		if (this.cursorPaintPending) return;
		this.cursorPaintPending = true;
		this.#parts.clock.after(0, () => {
			this.cursorPaintPending = false;
			if (this.repaintTimer !== undefined) {
				this.repaintTimer();
				this.repaintTimer = undefined;
			}
			this.repaint();
		});
	}

	/** New/removed streamed nodes: short trailing coalesce so the newcomer shows promptly; positions are preserved (without a scatter).
	 *  The schedule itself doesn't draw: the repaint draws when the visible model changed, and a feed that didn't change
	 *  the visible model (an observation of the page's own request, with instrumentation hidden) leaves the scene at rest. */
	private scheduleData(): void {
		if (this.repaintTimer !== undefined) return;
		this.#reading?.busy(true);
		this.repaintTimer = this.#parts.clock.after(DATA_DEBOUNCE_MS, () => {
			this.repaintTimer = undefined;
			this.repaint();
		});
	}

	/** A layout change (flatten/dag/group/type-filter): longer trailing coalesce so a burst of toggles collapses into one tween. */
	private scheduleLayout(): void {
		this.markDirty("arrange");
		this.layoutTimer?.();
		this.layoutTimer = this.#parts.clock.after(LAYOUT_DEBOUNCE_MS, () => {
			this.layoutTimer = undefined;
			this.repaintLayout();
		});
	}

	private repaint(): void {
		// The scene boots asynchronously; a model set before the library laid out its first data retries here until it has.
		if (!this.libraryLaidOut) {
			this.scheduleData();
			return;
		}
		// A ghost tween or an active drag owns the layout, don't re-place under it; retry after. (A mid-drag merge
		// would re-run toGraphData and overwrite the dragged bar's live z back to its stored target.)
		if (this.#parts.tween.running || this.pick.drag.dragging) {
			this.scheduleData();
			return;
		}
		// A batch that leaves the scene's inputs as they were doesn't build a model (PF31); a pending shape rebuild still feeds.
		const inputHash = sceneDataHash(this.sceneData());
		if (inputHash === this.lastInputHash && !this.nodeRebuildPending) return;
		this.lastInputHash = inputHash;
		this.invalidateModelCache(); // a fresh repaint: rebuild the model + seqNodes once, so the render-type caches re-key
		const firstFeed = this.lastModelHash === undefined; // the from-scratch layout (springy); later feeds are incremental clumps (damped)
		const existingIds = new Set(this.nodeMap.keys()); // before toGraphData rebuilds the map
		const { nodes, links, freshLinks } = this.pipeline.toGraphData(false);
		// Re-feeding graphData reheats the layout (visible jitter), so a model the changed inputs left as it was isn't fed,
		// such as a property that the chips leave unshown. In gantt the time z is part of the model, so a reschedule repaints.
		const hash = this.pipeline.hashCurrentModel(nodes, links);
		if (hash === this.lastModelHash && !this.nodeRebuildPending) return; // a pending shape rebuild must still feed
		this.lastModelHash = hash;
		this.markDirty("data"); // the visible model changed: draw it
		this.currentLinks = links;
		this.emitSceneChanged();
		// Refresh anchors before the feed reheats the engine, so the cohesion force targets the current group set.
		this.enclosureCtl.recomputeGroupAnchors(nodes);
		// Hold already-placed nodes fixed across the feed: the lib reheats (alpha→1) on graphData, which would
		// otherwise re-settle and visibly move them (visible jitter). Only NEW nodes stay free to settle in; these
		// data-pins release at the next engine stop (so the resting layout isn't permanently frozen).
		this.dataPinnedIds = [];
		for (const n of nodes) {
			if (existingIds.has(n.id) && n.x !== undefined && n.y !== undefined && n.fx === undefined) {
				n.fx = n.x;
				n.fy = n.y;
				this.dataPinnedIds.push(n.id);
			}
		}
		// Place before the feed: existing nodes are pinned above, so only newcomers move, from their seeds, damped, so a
		// streamed clump settles near its neighbours. The first feed places from scratch and rests at equilibrium, so a
		// later hover/focus repool moves an at-rest layout by zero. The renderer then only displays these positions.
		this.layoutForFeed().place(nodes, links, { damped: !firstFeed });
		this.#parts.engine.settle();
		if (this.nodeRebuildPending) this.forceNodeObjectRebuild(); // re-run the shape factory for every node this feed
		this.renderer?.draw({ nodes, links });
		this.animateFreshLinks(freshLinks);
		// Re-assert any active focus once the lib has (re)built the sprites for the new data.
		if (this.hoverSubject || this.selectedSubject) this.reassertFocus();
		this.frameEmbedScope();
	}

	// An embedded mount's requested scope (scopeToType with a focusType), applied in stages as the data arrives.
	private embedScope?: { focusType: string; revealed: boolean };

	/** Embedded mount (the host forwards a product's focusType): scope the view to the SCHEMA, only the Class + Property
	 *  chips visible, and frame it once it settles, around the focus type's node or, for an empty focus, the whole schema.
	 *  The host controls the filter, so the reveal is emitted as graph-scope-revealed; this owns only the camera. */
	scopeToType(focusType: string): void {
		this.embedScope = { focusType, revealed: false };
		this.revealEmbedScope();
	}

	/** The first stage, read from the model as it arrives rather than from a repaint: once the model holds the schema's
	 *  clusters, request that the host show only the schema chips (emit graph-scope-revealed exactly once). Every type is
	 *  hidden until then, so the model doesn't change what the scene draws, and a repaint that leaves the drawing as it was returns
	 *  before its final stages. */
	private revealEmbedScope(): void {
		const scope = this.embedScope;
		if (!scope || scope.revealed || !holdsSchema(this.model.knownClusters)) return;
		scope.revealed = true;
		this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.SCOPE_REVEALED, { detail: { types: schemaTypes() }, bubbles: true, composed: true }));
	}

	/** The second stage, on the repaint that draws the revealed schema: fit around the focus type's node once it is built, or
	 *  around the whole schema once a node of it is. */
	private frameEmbedScope(): void {
		const scope = this.embedScope;
		if (!scope?.revealed) return;
		if (scope.focusType === "" ? this.nodeMap.size === 0 : !this.nodeMap.has(scope.focusType)) return;
		this.embedScope = undefined;
		// Queued, not framed here: this runs on a repaint, with the feed's nodes still piled at the origin, so framing now
		// fits a bounding box barely bigger than one node and leaves the camera right over it. The camera applies a
		// queued reframe on the settle: the once-only frame, on the laid-out graph.
		this.cameraCtl.camera.queueFrame(FRAME.front);
	}

	/** Emit the control-bar inputs the host renders: the group-by axes and paint options derived from the visible model,
	 *  whether the active view suppresses grouping, the node/edge counts, the latest step, and the axis legend. Also
	 *  refreshes this scene's own axis-legend chrome. */
	private emitSceneChanged(): void {
		const links = this.currentLinks;
		const left = this.model.clusters.map(omittedOf);
		const omitted = { total: left.reduce((sum, c) => sum + c.total, 0), saturated: left.some((c) => c.saturated) };
		const relTypes = new Set(links.map((l) => l.predicate)).size;
		// Building the visible model sets the prune count, so the count matches the nodes drawn.
		this.visibleModel();
		const detail: GraphSceneChangedDetail = {
			groupByAxes: this.groupByAxes,
			forces: this.renderType.forces,
			paintOptions: availablePaints(this.model.visibleQuads, relationOfPredicate),
			counts: { nodes: this.nodeMap.size, edges: links.length, relTypes, omitted, pruned: this.prunedCount },
			latestStep: latestStepLabel(this.model.clusters, this.model.visibleQuads),
			axisLegend: this.renderType.axisLegend(),
			pins: this.getUserPins(),
		};
		this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.SCENE_CHANGED, { detail, bubbles: true, composed: true }));
		this.requestUpdate(); // refresh the scene's own axis-legend chrome
	}

	/**
	 * A layout change (flatten/dag/group/type-filter): rebuild the model, solve the FINAL layout off-screen, then
	 * glide every surviving node from where it is to where it lands over one eased tween, without physics moving the nodes: the
	 * one redraw the user requested. New nodes (rare on a layout change) appear at their target.
	 */
	private repaintLayout(): void {
		if (!this.libraryLaidOut) return;
		this.parkedPositions.clear(); // layout changes move everything; parked positions would be stale
		this.linkMap.clear(); // layout rebuilds all link objects; old __label refs point at orphaned meshes
		// The model doesn't hold a node to lay out yet (e.g. a persisted grouping restored before any data): bail rather than run an
		// empty solve: its engine-stop would consume the one-time initial warmup on which the FIRST real feed relies.
		if (this.nodeMap.size === 0 && this.model.quads.length === 0) return;
		this.invalidateModelCache(); // a fresh layout repaint: rebuild the model + seqNodes once, so the render-type caches re-key
		const from = this.pipeline.capturePositions(); // current spots (the old set), before toGraphData rebuilds the map
		// A drag-pin's lifetime ends at a major redraw: release before the solve so the new layout isn't warped around it.
		for (const n of this.nodeMap.values()) {
			n.fx = undefined;
			n.fy = undefined;
			n.fz = undefined;
		}
		// Refresh the group anchors with the CURRENT group-by BEFORE the feed, so the pipeline pins each member onto its
		// fresh shelf-packed cell. A grouping toggle changes the keys (type→role), so the previous feed's anchors are stale
		// and a pin against them silently misses, leaving members to the force, which spreads the boxes into each other.
		this.enclosureCtl.recomputeGroupAnchors([...this.nodeMap.values()]);
		const { nodes, links } = this.pipeline.toGraphData(true); // a deliberate re-place re-fits the depth scale to the new layout
		this.currentLinks = links;
		this.lastModelHash = this.pipeline.hashCurrentModel(nodes, links); // gantt-aware: matches the repaint() comparison baseline
		this.lastInputHash = sceneDataHash(this.sceneData());
		this.emitSceneChanged();
		// Place the final layout now, the pins the pipeline set hold lanes and groups; the force fills in the rest, and
		// glide every surviving node from where it is to where it lands over one eased tween. Positions exist before the
		// feed, so the tween starts immediately; the feed only gives the renderer the new set to display.
		this.layoutForFeed().place(nodes, links, { damped: false });
		this.beginLayoutTween(from, nodes);
		if (this.nodeRebuildPending) this.forceNodeObjectRebuild(); // chip↔box on a view switch, or resized gantt bars
		this.renderer?.draw({ nodes, links });
	}

	/** Rewind every node to where it was and glide its pin to where the solved layout places it, keeping the engine ticking
	 *  so it applies the pins and redraws links and chips; pinned nodes ignore the forces, so only the eased motion shows.
	 *  The tween translates the layout so the chosen node holds its place, except in a lane view. A lane view places each
	 *  node on its plane at its lane and time, and a translated layout would draw every node away from that placement. */
	private beginLayoutTween(from: Map<string, XYZ>, nodes: FGNode[]): void {
		this.#parts.tween.begin(this.#parts.clock.now(), from, nodes, isLaneView(this.viewType) ? null : this.selectedSubject);
		this.#parts.engine.hold();
		if (this.hoverSubject || this.selectedSubject) this.requestFocusAtRest();
	}

	/** Advance the tween one frame. At its end each node rests at its target, its pin released unless the reader dropped it
	 *  there or chose it, since a placement by hand is a decision and the reader's reference point mustn't drift. */
	private updateLayoutTween(): void {
		if (!this.#parts.tween.running || !this.#parts.tween.step(this.#parts.clock.now(), (id) => this.nodeMap.get(id))) return;
		this.#parts.tween.finish(this.nodeMap.values(), (id) => id === this.selectedSubject || this.userPins.has(id));
		this.#parts.engine.freeze(); // targets are an equilibrium; stop ticking so the graph rests
		this.onLayoutSettled(); // queued view-type re-aim + (re)draw the gantt ruler, now the layout rests at its targets
		this.#parts.clock.frame(() => this.enclosureCtl.updateEnclosureGeometry());
	}

	/** What is focused: the open column's node stays focused while a column is open; hover takes over only when a node isn't selected. */
	private get focusId(): string | null {
		return this.activeSubject ?? this.hoverSubject;
	}

	/** The selected subject IF it is in the graph. A selection made elsewhere (a reply column, a search) can name a node
	 *  this graph does not show, filtered out by type, dropped by prune, or never fetched. The graph then doesn't have an active node:
	 *  the graph carries on exactly as it is, rather than dimming every node against a focus that is not on screen or
	 *  following a node that cannot be seen. The selection itself is untouched, so hiding and re-showing the type brings
	 *  the active node back. */
	/** The colour a glow is built with, before the per-frame cycle reaches it: the middle of the active ramp. */
	private get activeHighlightColor(): string {
		return itemAt(this.glowRamp, Math.floor(this.glowRamp.length / 2));
	}

	private get activeSubject(): string | null {
		return this.selectedSubject && this.nodeMap.has(this.selectedSubject) ? this.selectedSubject : null;
	}

	/**
	 * Parent for the enclosure group: the forcegraph entity's own object3D. The node coordinates are in the
	 * `forcegraphGroup` child (added to this object3D at identity, so it shares this coordinate space), but THAT child
	 * is cleared and rebuilt on every graphData re-feed, attaching here keeps the enclosures stably parented and in
	 * the same space, instead of being briefly orphaned each repaint.
	 */
	private enclosureParent(): Obj3D | undefined {
		const entity = this.querySelector("[forcegraph]") as (Element & { object3D?: Obj3D }) | null;
		return entity?.object3D ?? undefined;
	}

	/** New edges announce themselves: a short staggered particle burst runs along each (capped: a bulk arrival is its own signal). */
	/** Whether decorative motion (the breath, a newcomer's grow-in, particles on fresh links) may run: not while the
	 *  regulator rests it, since a frame then takes longer than decoration may. */
	private decorates(): boolean {
		return !this.regulation.resting;
	}

	/** Particles run along the links a feed brought, as decorative motion. Each particle wakes the scene for the frames
	 *  it takes to cross its link. */
	private animateFreshLinks(fresh: FGLink[]): void {
		if (!this.graph || fresh.length === 0 || !this.decorates()) return;
		for (const l of fresh.slice(0, 20)) {
			for (const delay of [80, 480, 880]) {
				this.#parts.clock.after(delay, () => {
					this.graph?.emitParticle(l);
					this.markDirty("particles", PARTICLE_CROSSING_FRAMES);
				});
			}
		}
	}

	/** Drop the per-repaint model memo. Called at each repaint entry so seqNodes()/visibleModel() rebuild once per
	 *  repaint and the render-type layout caches (which key on the array reference) invalidate exactly then. */
	private invalidateModelCache(): void {
		this.modelCache = undefined;
		this.seqNodesCache = undefined;
	}

	/** The inputs the visible model and its placement read, which a repaint hashes before it builds the model. */
	private sceneData(): TSceneData {
		const { visibleQuads, clusters, hiddenGraphs, hiddenPredicates, site, timeCursor } = this.model;
		const options = { flatten: this.flatten, grouped: this.groupingActive(), groupBy: this.groupBy, zBasis: this.config.zBasis, labelAsZ: this.labelAsZ };
		return {
			quads: visibleQuads,
			clusters,
			hiddenGraphs,
			hiddenPredicates,
			prune: this.config.prune,
			site,
			roleRels: roleEdgeLabels(),
			viewType: this.viewType,
			options,
			timeCursor,
		};
	}

	private visibleModel(): GraphModel {
		if (this.modelCache) return this.modelCache;
		const { model, pruned } = visibleGraph(this.sceneData());
		this.modelCache = model;
		this.prunedCount = pruned;
		return model;
	}

	/** The visible model's nodes as sequence-mapper input (id, @type, derived role via properties, recorded time). The
	 *  sequence view derives its actors/messages from these, see mapGraphToSeq. */
	private seqNodes(): SeqNode[] {
		if (this.seqNodesCache) return this.seqNodesCache;
		this.seqNodesCache = seqNodesOf(this.visibleModel().nodes, this.pipeline.extractTimes().times);
		return this.seqNodesCache;
	}

	/** Request that the host show the actor types, through the same reveal the schema scope uses. A no-op when they are all
	 *  shown already, so choosing the view repeatedly doesn't change the types shown. */
	private revealActorTypes(): void {
		const hidden = new Set(this.model.hiddenGraphs);
		const showing = [...this.model.knownClusters.keys()].filter((t) => !hidden.has(t));
		const types = actorTypesFor(showing).filter((t) => hidden.has(t));
		if (types.length === 0) return;
		this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.SCOPE_REVEALED, { detail: { types }, bubbles: true, composed: true }));
	}

	/** The actor bars the active view draws, each with what is attached to it in appearance order: the reading the
	 *  accessible document follows, so the document and the picture give one account. Null off an actor-built view. The
	 *  membership is the layout's own (`barOf`), never re-derived from where things landed. */
	private actorBars(): Array<{ id: string; label: string; nodeIds: string[] }> | null {
		const layout = this.renderType.seqLayout?.();
		return layout && layout.actors.length > 0 ? actorBars(layout) : null;
	}

	private onNodeClick(n: FGNode, e?: MouseEvent): void {
		if (n.isCluster) {
			this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.CLUSTER_EXPAND, { detail: { type: n.type }, bubbles: true, composed: true }));
			return;
		}
		// In the ontology view a node IS a schema term, not an individual. A Class opens its own type column (its CLASS
		// view: description, schema graph, individuals), the same navigation a #Type reference / a graph Class-click uses,
		// so exploring the schema stays in the schema rather than dropping into a list of instances. A Property opens the
		// windowed instances of a type that declares it, sorted by it (zero instances → a pane doesn't open).
		const term = schemaTermOf(n.type);
		if (term === SCHEMA_TERM.class) {
			this.openPane({ paneType: "type", persistedAs: n.id }, e);
			return;
		}
		if (term === SCHEMA_TERM.property) {
			this.openOntologyInstances(n, e);
			return;
		}
		// Opening a node hands the view to the user: from here the camera is theirs, exactly as after a zoom/pan/orbit.
		// The load-time auto-fit ends so that selecting/focusing a node, which re-pools link colours and can nudge the
		// layout: never re-frames under them ("the graph re-zoomed when I clicked a node"). A cluster-expand is excluded
		// above: it streams in new nodes, which SHOULD still auto-frame.
		this.cameraCtl.camera.takeControl();
		// Pin the clicked node NOW, at its click-time position. Selection (and its pin) only comes back after the column's
		// async load, if anything reheats the engine in that gap, an unpinned node would drift and then be pinned at the
		// moved spot. Locking it here keeps the user's reference point exactly where they clicked. setSelectedSubject owns
		// the release (it unpins the previous selection); a fresh feed/relayout clears all pins as before.
		if (n.x !== undefined && n.y !== undefined) {
			n.fx = n.x;
			n.fy = n.y;
			n.fz = n.z;
		}
		// Follow moves at CLICK time: the selection only returns after the column's async load, and does not re-fire for
		// an already-selected subject: the camera must not wait on either. Choosing a node is the ONLY thing that moves
		// a following camera, so a pan or orbit afterwards stands until the next node is chosen.
		if (this.config.follow && n.id !== this.selectedSubject) this.cameraCtl.follow(n.id);
		this.openPane({ paneType: "entity", persistedAs: n.type, id: n.id }, e);
	}

	/** Request that the page open a pane beside the one holding this graph. This bundle's panes aren't the page's, so the
	 *  request is an event, parsed here so a malformed pane fails at its source. */
	private openPane(pane: DesiredPane, e?: MouseEvent): void {
		const detail: TPaneOpen = PaneOpenSchema.parse({ pane, addToSelection: addsToSelection(e) });
		this.dispatchEvent(new CustomEvent(SHU_EVENT.PANE_OPEN, { detail, bubbles: true, composed: true }));
	}

	/** Open the windowed instances column for a clicked ontology Property: the instances of a declaring type, sorted by it
	 *  (shu-filter-column → graphQuery). Zero instances to show (an abstract super-property, or a property the types
	 *  don't declare) → a column doesn't open. */
	private openOntologyInstances(n: FGNode, e?: MouseEvent): void {
		const target = this.propertyInstancesTarget(n.id);
		if (target) this.openPane({ paneType: "filter-prop", ...target }, e);
	}

	/** A Property's instances target: the first type whose data USES the rel, or any of its sub-properties, since
	 *  an abstract super-property (inRoleOf) is never used directly, but its concrete descendants (issuer, fromActor) are.
	 *  Opens that type's column keyed by the rel that's used. Undefined only when the data doesn't use the rel or a
	 *  descendant: the actual uses, not the declared rdfs:domain, which a super-property or an undeclared rel wouldn't have. */
	private propertyInstancesTarget(rel: string): { persistedAs: string; predicate: string } | undefined {
		for (const q of this.model.quads) if (!isSchemaType(q.namedGraph) && isSubPropertyOf(q.predicate, rel)) return { persistedAs: q.namedGraph, predicate: q.predicate };
		return undefined;
	}

	/** Open a node's column programmatically, exactly the path a click takes (onNodeClick → PANE_OPEN). The
	 * production "reveal this node" entry point (also lets a test drive the open without a flaky WebGL pixel click,
	 * which synthetic pointer events can't reliably deliver to the lib's raycaster headless). Returns false if absent. */
	openNode(id: string): boolean {
		const n = this.nodeMap.get(id);
		if (!n) return false;
		this.onNodeClick(n);
		return true;
	}

	/** Set or clear the hovered node as a keyboard reader's focus on an entry of the reading does: the real focus pass, the
	 *  same effect a pointer hover has, minus the library's raycaster. */
	setHoveredNode(id: string | null): void {
		const n = id ? (this.nodeMap.get(id) ?? null) : null;
		this.hoverSubject = n?.id ?? null;
		this.updateHoverInfo(n);
		this.requestFocusAtRest(); // a hover without a pointer over the canvas must still wake the paused loop
		this.applyFocus();
	}

	/** The current column-view node (the host publishes it through the shared selection system). Sticky focus for
	 * adjacency dimming, and the node that wears the active frame. The selected node is also PINNED in place while
	 * selected: the user's reference point holds still through stream settles and reheats; everything else lays out
	 * around it. Deselection releases the pin. */
	setSelectedSubject(subject: string | null): void {
		const previous = this.selectedSubject;
		if (this.selectedSubject && this.selectedSubject !== subject) {
			const prev = this.nodeMap.get(this.selectedSubject);
			if (prev) {
				prev.fx = undefined;
				prev.fy = undefined;
				prev.fz = undefined;
			}
		}
		this.selectedSubject = subject;
		const n = subject ? this.nodeMap.get(subject) : undefined;
		if (n) {
			n.fx = n.x;
			n.fy = n.y;
			n.fz = n.z;
		}
		if (this.config.follow && subject && subject !== previous) this.cameraCtl.follow(subject); // a NEW active node centres; re-asserting the same one leaves the camera where the reader put it
		this.reassertFocus();
	}

	/** Light what a preview names and dim the rest: a type hovered in the host's filter legend, or nodes the host names.
	 *  Null clears the preview. */
	setPreview(preview: TGraphPreview | null): void {
		this.preview = preview;
		this.reassertFocus();
	}

	/** A mode/dimensionality change (flatten/dag/group): coalesce into one debounced ghost tween (see repaintLayout). */
	private relayout(): void {
		if (!this.graph) return;
		this.scheduleLayout();
	}

	/* Visual-graph navigation, exposed imperatively so a keyboard shortcut or a button drives ONE path. These are the ONLY
	 * sanctioned camera changes: the explicit, user-initiated re-framing. Another change (a
	 * node click, focus, data feed, or a resize) may not reset the zoom: the graph never auto-determines its framing. */

	/** Re-frame so the whole graph fits the viewport: the "fit" button/step, view-relative: the render type declares
	 *  what fit means for its view (a lane view re-establishes its canonical frame; the force family keeps the orbit
	 *  orientation and re-sizes). While the layout is still moving the move is queued for the settle; framing now would
	 *  frame where the nodes are, not where they stop. Delegates to the camera controller, the sole owner of framing. */
	fitGraph(): void {
		this.cameraCtl.fit();
	}

	/** The links the scene draws, by which a host names an edge it points at (linkKey). */
	get links(): readonly FGLink[] {
		return this.currentLinks;
	}

	/** The one "layout has come to rest" hook: both settle paths (a no-tween engine stop and a tween's completion) call
	 *  it, so they can't drift: apply any queued framing move, then (re)draw the active lane view's axis overlay.
	 *  Following does NOT re-centre here: a settle is not a choice the reader made, and re-centring on one would undo
	 *  a pan or an orbit the moment the layout came to rest. */
	private onLayoutSettled(): void {
		this.cameraCtl.settled();
		this.updateLaneAxis();
	}

	/** Draw the calendar ruler for a view that reads along a calendar, and take it off screen for one that does not, so a
	 *  view switch cannot leave the previous view's ruler behind. A sequence's lifelines are the actor chips themselves,
	 *  so it doesn't need an overlay of its own. */
	private updateLaneAxis(): void {
		if (this.renderType.drawsCalendarAxis) this.ganttOverlay.drawAxis(this.ganttAdornment);
		else this.ganttOverlay.clearAxis();
	}

	/** Rotate to a head-on aim: `xy` faces the layout plane (the front default), `z` faces the depth axis (time reads left→right). */
	rotateTo(aim: "xy" | "z"): void {
		this.cameraCtl.rotateTo(aim);
	}

	/** The visible graph as one JSON-LD node: the single representation the copy-graph button and `summarizeForContext` both use, so what a person copies and what the model reads are the same data. The members are the system's own statement projection (the shape getClusteredQuads serves and chat batching consumes), not an invented nodes/edges dialect. */
	graphJsonLd(): Record<string, unknown> {
		const { nodes, edges } = this.visibleModel();
		const hidden = new Set(this.model.hiddenGraphs);
		const quads = this.model.visibleQuads.filter((q) => !hidden.has(q.namedGraph));
		// `nodeCount`/`edgeCount` describe the graph the statements project (the render's own node/edge set), so a reader: a
		// model, the clipboard, or a driver asserting expected values, has the counts without re-deriving them from the
		// statements. `totalItems` stays the view's own member count (the statements).
		return {
			"@id": "view:graph",
			name: "visible graph",
			nodeCount: nodes.length,
			edgeCount: edges.length,
			totalItems: quads.length,
			// How many records the store holds of each type the graph read, and how many the view draws: a type drawn in
			// part, or hidden, still has every record it holds.
			typesHeld: this.model.clusters.map((c) => ({ type: c.type, held: c.totalCount, drawn: hidden.has(c.type) ? 0 : c.sampledCount })),
			items: quads.map(({ subject, predicate, object, namedGraph }) => ({ subject, predicate, object, namedGraph })),
		};
	}

	/** The host's copy-graph button copies the same JSON-LD a model reads, pretty-printed. */
	graphCopyText(): string {
		return JSON.stringify(this.graphJsonLd(), null, 2);
	}

	/** What a reader is looking at, for a reader who is not looking at it: the statements about the node they are on
	 *  first, and the call that reads every one. What travels and what a window holds keep what arrives first. */
	summarizeForContext(): TLinkedData | null {
		const whole = this.graphJsonLd();
		const stated = whole.items as Array<{ subject: string; object: unknown }>;
		return {
			...whole,
			[PAGE_TERMS.next]: readsEveryStatement({ perTypeLimit: this.model.perTypeLimit, accessLevel: appAccessLevel() }),
			items: statedAboutFirst(stated, this.activeSubject),
		};
	}
}

defineElement(SHU_TAG.GRAPH_SCENE, ShuGraphScene);
