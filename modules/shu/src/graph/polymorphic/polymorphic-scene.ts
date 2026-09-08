import "aframe";
import ForceGraphVR from "3d-force-graph-vr";
import SpriteText from "three-spritetext";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { html, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "../../components/shu-element.js";
import { SITE_KEY, HYPERMEDIA_ROLE_REL_KEY, type GraphModel } from "../../graph-model.js";
import { setSelectedSubject as publishSelection, DEFAULT_PER_TYPE_LIMIT } from "../../quads-snapshot.js";
import { formatDate } from "../../util.js";
import { SHU_TEST_IDS } from "../../test-ids.js";
import { FrameScheduler } from "../polymorphic/polymorphic-frame.js";
import { EngineGovernor, type TPacedGraph } from "../polymorphic/polymorphic-engine.js";
import { PolymorphicProfiler } from "../polymorphic/polymorphic-profiler.js";
import { makeTroikaChip, spriteVisual, type ChipThree } from "./polymorphic-troika-label.js";
import { GLOW_RAMP, type GlowThree } from "../polymorphic/polymorphic-highlight.js";
import { typeAvatar } from "../polymorphic/polymorphic-type-avatar.js";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { isSubPropertyOf } from "@haibun/core/lib/resources.js";
import { type GroupKeyMode, easeInOutCubic, type XYZ } from "../grouping.js";
import { type KindTiers } from "../focus-policy.js";
import { quadsToGanttModel, cascadeReschedule } from "../gantt-model.js";
import { availablePaints, browserRelOf } from "../paint-select.js";
import { ganttBarTimes, GANTT_ROW_H, GANTT_BAR_H, GANTT_BAR_D, GANTT_MIN_BAR_W, GANTT_GHOST_PAD } from "../gantt-layout.js";
import { type Adornment } from "../graph-layout.js";
import { PolymorphicCamera, clearStripOffset, type GanttExtent } from "./polymorphic-camera.js";
import { ndcToClient, clientToNdc, ndcOnScreen, NDC_EDGE, NDC_SPAN, type TNdc, type TClientPoint } from "../polymorphic/polymorphic-project.js";
import { syncPickTarget, restorePickTarget, type TPickObject, type TScaleRestore } from "../polymorphic/polymorphic-pick-sync.js";
import { RenderContext } from "./polymorphic-render-context.js";
import { DataPipeline, visibleGraphModel } from "../polymorphic/polymorphic-data-pipeline.js";
import { type RenderType, type TViewForces, buildRenderTypeRegistry } from "../polymorphic/polymorphic-render-type.js";
import type { ViewType } from "../polymorphic/polymorphic-views.js";
import { FRAME, VIEW, viewChangeRebuildsNodes } from "../polymorphic/polymorphic-views.js";
import { ONTOLOGY_CLASS, ONTOLOGY_PROPERTY, isSchemaType, propertyVocabulary } from "../ontology-projection.js";
import { DesiredPaneSchema } from "../../pane-state.js";
import { actorTypesFor, getValidTimeField, roleEdgeLabels, roleNounFor } from "../../rels-cache.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { compositeRenderer, threeRenderer, type IGraphRenderer } from "../polymorphic/polymorphic-renderer.js";
import { A11yRenderer } from "./polymorphic-a11y-renderer.js";
import { SEQ_LANE_SPACING, actorBars, type TSeqModel } from "../polymorphic/sequence-model.js";
import { type FGNode, type FGLink, type TSprite, linkEndId, neighboursOf } from "../polymorphic/polymorphic-graph-types.js";
import { forceLayout, type IGraphLayout } from "../polymorphic/polymorphic-layout.js";
import { SvgRenderer } from "../polymorphic/polymorphic-svg-renderer.js";
import { NodeDrag, DRAG_THRESHOLD_PX } from "../polymorphic/polymorphic-drag.js";
import { NODE_TEXT_COLOR, chipTextHeight } from "../polymorphic/layout-forces.js";
import { paintMarkScene, type ShapeLabel } from "../polymorphic/polymorphic-node-shapes.js";
import { PolymorphicFocus, NODE_RENDER_ORDER, NODE_FONT_SIZE } from "../polymorphic/polymorphic-focus.js";
import {
	EnclosureController,
	type EnclosureThree,
	ENCLOSURE_FILL_OPACITY,
	ENCLOSURE_EDGE_OPACITY,
	ENCLOSURE_RENDER_ORDER,
	ENCLOSURE_LABEL_RENDER_ORDER,
	ENCLOSURE_LABEL_HEIGHT,
} from "./polymorphic-enclosure.js";
import { presentationForType } from "../type-presentation.js";
import type { NodeMark } from "../graph-scene.js";

/**
 * shu-graph-scene — the A-Frame / ForceGraphVR rendering surface, extracted from shu-polymorphic-graph-view so the scene is
 * reusable independent of the data feed and the control bar. It owns the WebGL scene, camera, render loop, node objects,
 * focus/highlight, drag, enclosures, and the gantt/sequence axes, and is driven entirely by inputs pushed from a host:
 *
 *   setModel(model)         — the quads/clusters to render (the host's time-filtered slice)
 *   setConfig(patch)        — the layout choices (view type, flatten, grouping, z basis, label-as-z)
 *   setTimeCursorValue(ms)  — the depth-basis cursor (a re-style, not a data change)
 *   setSelectedSubject(id)  — the highlighted node (pins it, dims the rest)
 *   setPreviewType(type)    — a type hovered in a legend (dims every other type)
 *   scopeToType(type)       — an embedded schema view: fit around one type's node
 *
 * It emits (bubbles, composed) the constants in GRAPH_SCENE_EVENT. The host (a data-feeding wrapper such as
 * shu-polymorphic-graph-view, or an embedding column) owns fetch/SSE/selection publication and the controls, and forwards
 * those events to the app.
 *
 * Light DOM (createRenderRoot returns this): A-Frame resolves its scene/camera through document.querySelector, which a
 * shadow root would hide — a shadow-mounted scene boots but never attaches its graph.
 */

/** The data the scene renders — the host's time-filtered slice plus the cluster metadata the layout and filter need. */
export interface GraphSceneModel {
	quads: TQuad[];
	visibleQuads: TQuad[];
	clusters: TCluster[];
	knownClusters: Map<string, TCluster>;
	hiddenGraphs: string[];
	/** The predicates whose edges are hidden (the filter's properties group) — dropped from the visible model, so every
	 *  medium (WebGL, sequence, still, JSON-LD, the accessible document) reads the same edge set. */
	hiddenPredicates: string[];
	site?: string;
	perTypeLimit: number;
	timeCursor: number | null;
}

/** The layout choices — owned and persisted by the host, pushed down as a plain object so the scene holds no persisted state. */
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
	/** Prune nodes without a visible edge — a visible-model adjustment, so every medium (WebGL, sequence, still,
	 *  JSON-LD, the accessible document) reads the same pruned graph. */
	prune: boolean;
	/** Hold the accessible document open beside the scene. It is always there and always current — a keyboard reader
	 *  tabs into it — and this shows it to everyone else too. */
	readAsDocument: boolean;
}

/** One vertex the host must persist for a gantt-bar reschedule: the vertex to rewrite and its new start/end as a JSON string. */
export interface RescheduleUpdate {
	label: string;
	id: string;
	data: string;
}

/** The neutral outputs the scene emits; the host re-dispatches or acts on each. */
export const GRAPH_SCENE_EVENT = {
	/** A node open request (an ordinary individual): {label, subject, addToSelection}. */
	NODE_CLICK: "graph-node-click",
	/** An ontology term open request: a DesiredPane detail for the windowed-instances pane. */
	NODE_OPEN_PANE: "graph-node-open-pane",
	/** A cluster node was clicked to expand its type: {type}. */
	CLUSTER_EXPAND: "graph-cluster-expand",
	/** A gantt-bar drag committed: {updates: RescheduleUpdate[]} for the host to persist and refetch. */
	RESCHEDULE_REQUEST: "graph-reschedule-request",
	/** Emitted at each repaint end so the host can re-render its control bar. */
	SCENE_CHANGED: "graph-scene-changed",
	/** An embed scope wants the schema chips shown: {types}. */
	SCOPE_REVEALED: "graph-scope-revealed",
} as const;

/** The graph-scene-changed payload: the control-bar inputs the host renders. */
export interface GraphSceneChangedDetail {
	groupByAxes: string[];
	/** The options the active view forces, so a host offers only the ones this view honours. */
	forces: TViewForces;
	paintOptions: Array<{ id: string; label: string }>;
	counts: { nodes: number; edges: number; relTypes: number; omitted: number };
	latestStep: string | null;
	axisLegend: { from: string; to: string; count: number } | null;
	/** The user's drag-pins (id → [x,y]) so the host can persist them across reloads. */
	pins: Record<string, [number, number]>;
}

/** Empty state schema: the scene holds no persisted state — all inputs are pushed via setModel/setConfig. */
const SceneStateSchema = z.object({});

// Node chips mirror the SVG overview: the cluster type-colour as fill, dark text, a light stroke —
// readable on either theme because the cluster palette is always light. Only the chrome (scene
// background, edges) follows the document theme tokens.
const NODE_BORDER_COLOR = "#cccccc";
// The glow the ACTIVE node carries — the node whose column is open, the one being read. Drawn behind the mark, so it
// surrounds a chip and a lane bar alike; its colour cycles through the theme's warm ramp (see polymorphic-highlight).

// three-forcegraph forces link objects to renderOrder 10; draw nodes above that (edges sit behind), labels between.
// NODE_RENDER_ORDER / FOCUS_RENDER_ORDER / NODE_FONT_SIZE live with the focus subsystem (it drives the chip raster + pop).
const EDGE_LABEL_RENDER_ORDER = 15;
const EDGE_LABEL_TEXT_HEIGHT = 2; // edge label sprites' intrinsic world text height (readableK scales from it on focus)
// A persistent arrowhead on every edge so its direction (source → target) is always clear, not just during a
// transient particle burst. Sized to the chip scale (~3) and placed past the link's midpoint toward the target.
const ARROW_LENGTH = 3.5;
const ARROW_REL_POS = 0.68;
const LINK_OPACITY = 0.55; // resting edge opacity; focus raises incident edges to full and dims the rest (the focus subsystem reads it via the injected line tiers)

// Two debounce tiers, by intent. A data arrival (new/removed nodes streaming in) coalesces into ~half-second clumps:
// one repaint per window, so a steady trickle arrives as occasional batches that settle against the (pinned) existing
// layout — rather than a per-node reheat that keeps the whole graph wiggling. A layout change (flatten / dag / group /
// type-filter) coalesces longer so rapid toggles collapse into ONE transition, then animates as a controlled tween.
const DATA_DEBOUNCE_MS = 500;
// The scene renders on demand: after a discrete change (data, selection, resize, theme) it keeps drawing for this many
// frames so the change and any short ease land, then it idles. Continuous motion (layout settle, tween, drag, camera
// damping) and the pointer being over the canvas keep it awake on their own.
const BREATH_EVERY = 6; // wall frames between breaths of the active node's glow — see the rAF loop
const DIRTY_GRACE_FRAMES = 30;
// Cadence for the canvas-geometry wake detector (mouse-pick bounds + viewport aspect watchdog), sampled even when idle.
const CANVAS_GEOMETRY_EVERY = 15;
const LAYOUT_DEBOUNCE_MS = 450;

// Controlled "ghost" tween for a layout change: solve the final layout off-screen, then glide every node along one
// eased path from where it is to where it lands (links follow). No physics churn — the engine only holds the pins.
const TWEEN_MS = 700;

// three.js MOUSE enum values for OrbitControls.mouseButtons (ROTATE=0, DOLLY=1, PAN=2).
const ORBIT_ROTATE = 0;
const ORBIT_PAN = 2;

// The enclosure fill/edge/label render orders + heights live with the enclosure subsystem (it draws the boxes); they're
// re-used here by the gantt axis ruler + the gantt drag ghost (same render layer) and the focus tier consts.
// The slice of A-Frame's bundled THREE that the group enclosures + the gantt overlays drive. Constructed at runtime via the scene's OWN
// THREE instance (AFRAME.THREE) — never a separately imported `three`, which would be a second copy whose objects
// the scene can't render. Typed structurally so this view keeps depending on no three .d.ts.
type Disposable = { dispose(): void };
type Vec3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
type Obj3D = {
	position: Vec3;
	scale: Vec3;
	renderOrder: number;
	visible: boolean;
	parent: Obj3D | null;
	children: Obj3D[];
	raycast: () => void;
	add(o: Obj3D): void;
	remove(o: Obj3D): void;
};
type EnclMaterial = Disposable & { color: { set(c: string): void }; opacity: number };
type DragPlane = { setFromNormalAndCoplanarPoint(normal: Vec3, point: Vec3): unknown };
interface ThreeNs {
	Group: new () => Obj3D;
	Mesh: new (geometry: unknown, material: unknown) => Obj3D;
	LineSegments: new (geometry: unknown, material: unknown) => Obj3D;
	BoxGeometry: new (w: number, h: number, d: number) => Disposable;
	EdgesGeometry: new (geometry: unknown) => Disposable;
	BufferGeometry: new () => Disposable & { setAttribute(name: string, attr: unknown): void };
	Float32BufferAttribute: new (array: number[], itemSize: number) => unknown;
	MeshBasicMaterial: new (params: Record<string, unknown>) => EnclMaterial;
	LineBasicMaterial: new (params: Record<string, unknown>) => EnclMaterial;
	DoubleSide: number;
	// Node-drag math: a ray from the pointer through the camera — picks the pressed sprite, then follows the
	// camera-facing plane through it. `camera` must be set for Sprite.raycast (billboard math).
	Raycaster: new () => {
		camera: unknown;
		setFromCamera(coords: { x: number; y: number }, camera: unknown): void;
		ray: { intersectPlane(plane: DragPlane, target: Vec3): Vec3 | null };
		intersectObjects(objects: unknown[], recursive?: boolean): Array<{ object: unknown }>;
	};
	Plane: new () => DragPlane;
	Vector2: new (x?: number, y?: number) => { x: number; y: number };
	Vector3: new (x?: number, y?: number, z?: number) => Vec3;
}
const aframeThree = (): ThreeNs | undefined => (globalThis as { AFRAME?: { THREE?: ThreeNs } }).AFRAME?.THREE;

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

/** A visible node projected as sequence-mapper input: identity, derived @type/role, label and recorded time. */
type SeqNode = { id: string; type: string; displayLabel?: string; properties?: Record<string, unknown>; __t?: number };

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

/** The slice of the renderer this scene drives: its size, its pixel ratio, and whether it is presenting in VR. */
export type TSceneRenderer = { setSize(w: number, h: number, updateStyle: boolean): void; getPixelRatio(): number; xr?: { isPresenting?: boolean } };

/** The slice of the camera this scene drives: its framing, where it sits, and what it looks at. */
export type TSceneCamera = {
	aspect: number;
	fov?: number;
	position?: { x: number; y: number; z: number };
	updateProjectionMatrix(): void;
	getWorldDirection?(target: Vec3): Vec3;
	matrixWorld?: { elements: number[] }; // columns 0/1 = the camera's right/up axes, for screen-oriented placement
};

export class ShuGraphScene extends ShuElement<typeof SceneStateSchema> {
	/** The host's time-filtered data slice; replaced whole via setModel. */
	private model: GraphSceneModel = DEFAULT_MODEL;
	/** The host's layout choices; patched via setConfig. */
	private config: GraphSceneConfig = DEFAULT_CONFIG;

	/** How this scene is drawn. The library-backed renderer is built at mount; a caller that wants the graph shown in
	 *  another medium — a report, a still, a test that reads what was drawn — sets its own before mounting. */
	renderer?: IGraphRenderer;

	/** The ForceGraphVR instance — public so the host can delegate its `graph` accessor 1:1. Displaying goes through the
	 *  renderer; what remains here is the camera, the controls, and the force simulation (see the plan doc). */
	graph?: FGInstance;
	private controls?: OrbitControls;
	private rafHandle?: number;
	// Render-on-demand bookkeeping: a monotonic frame counter, the frame up to which a discrete change keeps the scene
	// drawing, and whether the A-Frame render loop is currently paused because nothing is moving.
	private rafFrame = 0;
	private dirtyUntilFrame = 0;
	private scenePaused = false;
	/** Set by the per-frame highlight job: an active node's glow is breathing, so the loop must keep drawing. Cleared
	 *  the frame the selection goes away, which lets the scene idle again. */

	// Set when the focus (selection/hover) changes or a settle rebuilt the visuals: the render loop keeps drawing until it
	// applies the focus at rest, then clears it. Distinct from dirtyUntilFrame (a fixed grace) — a focus may take longer.
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

	/** The group-by axes offered: `@type` and the highest-priority actor always, plus each actor predicate that ACTUALLY
	 *  appears on a visible node, plus the serving site once the view holds data from MORE than one site (a single-site
	 *  graph has nothing to separate) — all derived from the data, so an axis the graph does not carry never shows. */
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
	 *  IS its own grouping — its lanes are the axis; role/type enclosure boxes would just bleed over the lanes). The
	 *  enclosure controller and the settle-time geometry pass both read this so a lane view never draws boxes. */
	private groupingActive(): boolean {
		return this.effective.grouped;
	}
	private edgeLabelColor = "#555555";
	private edgeLineColor = "#888888";
	private chipTextColor = NODE_TEXT_COLOR; // text ON a node chip (light type-colour bg) — dark in both themes (--shu-fg-on-swatch)
	private sceneTextColor = "#e6e6e6"; // text OFF a chip, on the scene bg (gantt bar labels) — follows --shu-fg (white in dark)
	private glowRamp: readonly string[] = GLOW_RAMP.dark; // which warm ramp the glow cycles through — chosen by theme
	private focusEdgeColor = "#222222"; // full-contrast foreground: a focused node's edges + labels brighten to it
	private particleColor = "#1a6b3c";
	private focusTextPx = 13; // from --shu-font-md: the pop matches the app's own text size (follows --shu-scale)
	// Sole owner of camera control: framing/viewport/nav + the load-time auto-fit and view-type re-aim state. It reads the
	// shared leaf refs (camera/controls/canvas/renderer/container) and the node positions through these accessors, read at
	// call time so a late-set ref or a re-fed nodeMap is always current; this component never mutates the camera directly.
	private camera = new PolymorphicCamera({
		camera: () => this.ctx.camera,
		controls: () => this.ctx.controls,
		container: () => this.ctx.container,
		renderer: () => this.ctx.renderer,
		canvas: () => this.ctx.canvas,
		nodePositions: () => this.ctx.nodeMap.values(),
		hasNodes: () => this.ctx.nodeMap.size > 0,
		reframeMode: () => this.renderType.reframeMode(),
		ganttExtent: () => this.ganttExtent(),
		sequenceExtent: () => this.sequenceExtent(),
		refreshPickBounds: () => this.refreshPickBounds(),
	});
	// The single interface to the live render world — late-bound three.js leaf refs + the shared mutable graph-state
	// collections, behind typed getters read at call time. The component still OWNS the refs/maps (DataPipeline mutates
	// nodeMap); subsystems extracted next read this ONE injected context instead of scattered private-field touches.
	private ctx = new RenderContext<FGNode, FGLink>({
		camera: () => this.fgCamera,
		controls: () => this.controls,
		container: () => this.fgContainer,
		renderer: () => this.fgRenderer,
		canvas: () => this.fgCanvas,
		sceneEl: () => this.fgSceneEl,
		nodeMap: () => this.nodeMap,
		currentLinks: () => this.currentLinks,
		linkMap: () => this.linkMap,
	});
	// The data-flow subsystem: owns the per-id node/link maps + parked positions + the sqrt-age depth scale, and turns
	// the quad model into {nodes, links, freshLinks}. Wired like the camera — constructor-injected accessors read at
	// call time, so a per-repaint-refreshed component field (group anchors, the layout-target caches) is always current.
	// Public so the host delegates its `pipeline` accessor 1:1 (unit tests write pipeline.nodeMap= to feed a node set).
	pipeline = new DataPipeline({
		viewType: () => this.viewType,
		flatten: () => this.flatten,
		// The ONE grouping predicate every consumer reads: a lane view's bars ARE its grouping, so a remembered "grouped"
		// choice must not place its nodes in container cells — that overrides the lane placement and the diagram is lost.
		grouped: () => this.groupingActive(),
		groupBy: () => this.groupBy,
		quads: () => this.model.quads,
		visibleQuads: () => this.model.visibleQuads,
		hiddenGraphs: () => this.model.hiddenGraphs,
		visibleModel: () => this.visibleModel(),
		lastModelHash: () => this.lastModelHash,
		timeCursor: () => this.model.timeCursor, // the pinning-aware cursor the host resolved (a snapshot-pinned view reads its frozen instant)
		zBasis: () => this.config.zBasis,
		validTimeFieldFor: (type) => getValidTimeField(type),
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
			// A view that lays out in one plane carries no x in its placement and names the plane it draws on instead.
			const x = lp.x ?? this.renderType.lanePlaneX;
			return x !== undefined ? { x, y: lp.y } : undefined;
		},
		userPinXY: (id) => this.userPins.get(id),
		startNewcomerPop: (n) => this.focusCtl.seedNewcomerPop(n),
	});
	// The focus subsystem: the whole purely-visual dim/highlight + the focus-chip MAGNIFY pop. Wired like the camera —
	// constructor-injected accessors read at call time, so a late-bound graph, a per-repaint nodeMap, or a theme-recoloured
	// colour field is always current; it OWNS the magnify animation state, the component delegates and reads nothing back.
	// (Named focusCtl, not focus — HTMLElement.focus() is a method on the element.)
	private focusCtl = new PolymorphicFocus({
		focusId: () => this.focusId,
		selectedId: () => this.activeSubject,
		previewType: () => this.previewType,
		nodeMap: () => this.nodeMap,
		currentLinks: () => this.currentLinks,
		enclosures: () => this.enclosureCtl.enclosures,
		graph: () => this.graph,
		engineFrozen: () => this.engine.mode === "frozen",
		pinNode: (n) => this.dataPinnedIds.push(n.id),
		worldPerPxAt: (pos) => this.camera.worldPerPxAt(pos),
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
	// the cohesion force. Wired like the camera — accessors read at call time, so a per-repaint nodeMap or a recoloured
	// label colour is always current; it OWNS the enclosure maps + the shared unit geometries, the component delegates.
	private enclosureCtl = new EnclosureController({
		three: () => aframeThree() as EnclosureThree | undefined,
		nodeMap: () => this.nodeMap,
		groupBy: () => this.groupBy,
		grouped: () => this.groupingActive(), // a lane/2D view (gantt/sequence) suppresses enclosures — its lanes/actors ARE the grouping
		edgeLabelColor: () => this.edgeLabelColor,
		enclosureParent: () => this.enclosureParent() as unknown as Parameters<Obj3D["add"]>[0] | undefined,
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
			labelOf: (participantId) => this.seqLabelFor(participantId),
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
	// Public so the host delegates its `nodeMap` accessor 1:1 (the control stepper reads nodeMap.values() to resolve nodes).
	get nodeMap(): Map<string, FGNode> {
		return this.pipeline.nodeMap;
	}
	private get linkMap(): Map<string, FGLink> {
		return this.pipeline.linkMap;
	}
	private compassEl: HTMLCanvasElement | null = null;
	private infoEl: HTMLElement | null = null; // hover overlay above the controls: label · type · its time with units
	private currentLinks: FGLink[] = [];
	private fitFrameTimer?: number;
	private repaintTimer?: number;
	private layoutTimer?: number;
	private lastModelHash?: number;
	// Per-repaint memo of the visible model and its sequence-node projection. The layered/sequence render types cache
	// their layout on the seqNodes() array reference and expect a fresh array only per repaint; seqNodes() built a new
	// array every call, so those caches never hit and the layout was recomputed ~once per node per feed. Cleared at each
	// repaint entry (invalidateModelCache), so the reference is stable within a repaint and fresh across repaints.
	private modelCache?: GraphModel;
	private seqNodesCache?: SeqNode[];
	// Active ghost tween: each frame the node pins ease from `from`→`to`. Null when no transition is running.
	private tween?: { start: number; from: Map<string, XYZ>; to: Map<string, XYZ> };
	// Active node drag: the node follows the pointer in the camera-facing plane; every other node is pinned so
	// nothing else moves. After release the dragged node's pin PERSISTS (a blocked view stays fixed) until the
	// next layout change re-solves and releases all pins.
	// The drag state-machine (down/move/up + the pin geometry) lives in NodeDrag, unit-tested with stubs — the flake it
	// replaces was entirely in picking a pixel out of an occluded WebGL scene, never in this logic. This component owns
	// only the DOM events + the THREE projection it hands NodeDrag (pick, plane, plane-hit).
	private nodeDrag = new NodeDrag({
		pick: (e) => this.pickNodeAt(e),
		makePlane: (n) => this.dragPlaneFor(n),
		planeHit: (e, p) => (p ? this.pointerPlaneHit(e, p as DragPlane) : null),
		nodes: () => this.nodeMap.values(),
		hold: () => this.engine.hold(),
		freeze: () => this.engine.freeze(),
		setControlsEnabled: (on) => {
			if (this.controls) this.controls.enabled = on;
		},
		dragReschedules: () => this.renderType.dragReschedules,
		updateGhost: (n) => this.updateGanttGhost(n),
		clearGhost: () => this.clearGanttGhost(),
		commit: (n) => void this.commitGanttDrag(n),
		selectedId: () => this.activeSubject,
		dropDataPin: (id) => {
			this.dataPinnedIds = this.dataPinnedIds.filter((x) => x !== id);
			// Remember where the user left it, so a reload can pin it back here (persisted by the host). The pin is read
			// from the drag's own fx/fy — where the pointer left the node — not from x/y, which the engine writes on its
			// next tick and which therefore still holds the pre-drag place when the drop lands between ticks.
			const n = this.nodeMap.get(id);
			const x = n?.fx ?? n?.x;
			const y = n?.fy ?? n?.y;
			if (n && x != null && y != null) {
				this.userPins.set(id, { x, y });
				n.x = x;
				n.y = y;
			}
			// Emit at drop so the host persists the pin now — the sole carrier of the pin set to the host; otherwise it
			// survives only if some later unrelated repaint happens to fire before reload.
			this.emitSceneChanged();
		},
	});
	// The cursor component raycasts every frame against its LAST KNOWN pointer position — when the pointer isn't
	// over the canvas at all, nodes drifting through that stale spot fire phantom hovers that dim the whole graph.
	// Hover is honored only while the pointer is actually present.
	private pointerOverCanvas = false;
	private selectedSubject: string | null = null; // sticky: the current column-view node (via the shared selection system)
	private hoverSubject: string | null = null; // transient: the hovered node
	private previewType: string | null = null; // a type hovered in the filter legend: dim every other type
	// Ontology (T-Box) mode: the view shows the SCHEMA that drives it — the Class + Property hierarchy from
	// getOntologyQuads — instead of the live instance data. While on, the live feeders (refetch/SSE) are suspended so a
	// streamed batch can't clobber the fixed ontology snapshot; toggling off refetches the live graph.
	private fgRenderer?: TSceneRenderer;
	// Public so the host delegates its `fgCamera` accessor 1:1 (tests project through it and wait for it before driving).
	fgCamera?: TSceneCamera;
	private frame = new FrameScheduler();
	private engine = new EngineGovernor();
	private profiler = new PolymorphicProfiler();
	private fgCanvas?: HTMLCanvasElement;
	private fgContainer?: HTMLElement;
	private fgSceneEl?: HTMLElement & { emit(name: string, detail?: unknown, bubbles?: boolean): void };
	private lastCanvasPos?: { left: number; top: number; width: number; height: number };
	private freshTimers: number[] = [];
	// Gantt layout: per-node calendar-grid target (subject id → world x/y of the bar CENTRE, plus the bar width = its
	// duration), recomputed in toGraphData when viewType is "gantt". The groupX/groupY forces pull each task to its
	// slot; the node object is a duration bar of width `w`. Non-task nodes have no entry.
	// Gantt layout target per task: y = lane (one row each, force-pulled), z = the bar's CENTRE on the linear time
	// axis (data-assigned in toGraphData), zLen = its duration as a z-span (the box depth). Time is the z axis; the
	// camera pivots so z lies flat/horizontal on screen.
	private ganttTargets = new Map<string, { y: number; z: number; zLen: number; start: number; end: number }>();
	// Calendar scale for the gantt layout: drag maps a node's new x back to a time through this (inverse of timeX).
	private ganttScale: { min: number; span: number } | undefined;
	// The calendar ruler the layout pass produced (baseline z-range + tick marks + baseline y); null off-gantt.
	private ganttAdornment: Adornment = null;
	// three-forcegraph caches each node's 3D object and only rebuilds when the nodeThreeObject accessor reference
	// changes. A node's SHAPE can change without its identity — chip↔gantt-box on a view switch, and a gantt span/
	// duration change resizes every bar (zLen is global, built into the box geometry). recomputeGanttTargets flags the
	// next feed (via setGanttShapeSig, the bar-width fingerprint) to re-bind the accessor — a full node rebuild.
	private nodeRebuildPending = false;
	private ganttShapeSig = "";
	private ganttAxisGroup?: Obj3D; // the gantt calendar ruler (baseline + tick marks + date labels), parented like the enclosures; null off-gantt
	private ganttGhost?: { group: Obj3D; label: TSprite }; // transient drag affordance: a wireframe outline + the new date-time, attached to the dragged bar (disposed via disposeGroup)

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
		// Config seeded before the scene mounts: stored only; the first repaint reads it.
		if (!this.graph) {
			this.emitSceneChanged();
			return;
		}
		if (patch.viewType !== undefined && patch.viewType !== prev.viewType) {
			const prevType = this.renderTypes.get(prev.viewType) ?? this.renderTypes.get(VIEW.force);
			// A view built on ACTORS needs its actors: a hidden actor type leaves the exchange with nobody in it, so
			// choosing the view reveals them, exactly as it settles the layout options it cannot honour.
			if (this.renderType.needsActors) this.revealActorTypes();
			// The new view may force options the old one honoured (a lane view settles grouping, flatten and label-as-depth),
			// so the enclosures and the chip text both belong to the view being left.
			if (this.renderType.forces.grouped === false) this.enclosureCtl.clearEnclosures();
			if ((prevType?.forces.labelAsZ ?? this.config.labelAsZ) !== this.labelAsZ) this.nodeRebuildPending = true;
			const nextMode = this.renderType.reframeMode();
			if (prevType && nextMode !== prevType.reframeMode()) this.camera.queueFrame(nextMode);
			// Crossing a node-shape boundary (chip ↔ gantt bar ↔ sequence activation bar) must rebuild the lib's identity-cached
			// node objects; a force↔td↔lr switch keeps the chips and must not.
			if (viewChangeRebuildsNodes(prev.viewType, patch.viewType)) this.nodeRebuildPending = true;
		}
		if (patch.follow !== undefined && patch.follow && !prev.follow && this.activeSubject) this.followActive(this.activeSubject); // turning follow on centres the active node at once
		if (patch.readAsDocument !== undefined && patch.readAsDocument !== prev.readAsDocument) {
			// Showing or hiding the reading changes one attribute on a region the renderer already keeps current: nothing
			// about the model or the layout moves, so this re-renders the template and stops there.
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

	/**
	 * THE layout query: a JSON-safe snapshot of the scene's observable state — node positions, group boxes,
	 * focus/drag/tween/engine state — for the behaviour suite and for humans in devtools. Tests assert layout
	 * quality against this surface, never against private fields. `sample` carries every node's actual x/y/z. The host
	 * delegates its own `inspect()` to this and registers itself on globalThis as `shuPolymorphic` for devtools.
	 */
	inspect(): Record<string, unknown> {
		const nodes = [...this.nodeMap.values()];
		return {
			nodes: nodes.length,
			links: this.currentLinks.length,
			pinned: nodes.filter((n) => n.fx !== undefined).length,
			highlighted: nodes.filter((n) => n.__visual?.hasHighlight).length, // nodes actually wearing the active glow (exactly the active node)
			focus: {
				hover: this.hoverSubject,
				selected: this.activeSubject,
				preview: this.previewType,
				litNodes: nodes.filter((n) => (n.__visual?.opacity ?? 1) > 0.9).length,
			},
			drag: this.nodeDrag.draggedId ? { id: this.nodeDrag.draggedId } : null,
			// A press in progress that has not (yet) crossed the drag threshold — i.e. still a potential click (it
			// becomes a node-open on release). Null once the pointer is up.
			dragPending: this.nodeDrag.pendingId,
			tween: this.tween ? { elapsedMs: performance.now() - this.tween.start } : null,
			pointerOverCanvas: this.pointerOverCanvas,
			engineMode: this.engine.mode,
			// Render-on-demand state: the scene pauses when nothing is moving and no recent discrete change is pending.
			// A reader whose focus/highlight assertion depends on a redraw can tell a paused scene from a live one.
			render: { paused: this.scenePaused },
			// A data or layout repaint is debounced and still to run: the scene shows the PREVIOUS feed's placement, so a
			// reader of this snapshot has not yet seen the effect of the change that scheduled it (a z-basis switch, a
			// grouping toggle). The engine is idle in that window, so engineMode alone would call it settled.
			repaintPending: this.repaintTimer !== undefined || this.layoutTimer !== undefined,
			// Render-stage timing accumulated since the last resetProfile() — how raising the per-type limit spends the
			// main thread, split into compute / force-warmup / label-textures (the profiling control step reads this).
			profile: this.profiler.profile,
			frameJobs: this.frame.names(),
			controlsLeft: this.controls?.mouseButtons.LEFT ?? null,
			grouped: this.groupingActive(),
			viewType: this.viewType,
			// The sequence-diagram ground truth, or null off-sequence: the participant actors, the time-ordered
			// cross-participant messages, and each placed node's lane (y) + time (z) — so a test asserts the diagram and
			// that participants sit in distinct lanes at their times, all from the graph (no hand-applied labels).
			sequence: this.sequenceInspect(),
			// The td/lr layered ground truth (null off those views): per-node pinned target + rendered position + flow axis,
			// so a test asserts the flow reads monotonically by layer and the pins held.
			layered: this.layeredInspect(),
			// World-space half-diagonal of the laid-out graph — the layout-spread signal, camera-INDEPENDENT (unlike
			// onScreen.span, which the auto-fit holds ~constant by following the spread). A from-scratch force layout
			// spreads over several settles with a stable node count, so "wait for the engine frozen" returns mid-spread;
			// a test asserting a settled camera must wait for THIS to stop growing (see the controls' waitForLayoutStable).
			bboxRadius: this.camera.bboxRadius(),
			// Camera framing — so a resize/click can be asserted not to zoom or re-frame (fov + position + aim target).
			camera: this.fgCamera?.position
				? { fov: this.fgCamera.fov ?? null, x: this.fgCamera.position.x, y: this.fgCamera.position.y, z: this.fgCamera.position.z, target: this.camera.targetPoint() }
				: null,
			follow: this.config.follow,
			// Azimuth of the camera around its target (radians) — a pan translates camera+target together so this holds; an
			// orbit changes it. Lets a test tell a sanctioned orbit gesture from a pan without spelunking OrbitControls.
			azimuth: this.camera.azimuth(),
			// worldPerPx is THE zoom level the user sees (world units per screen pixel at the graph centre) — a function
			// of fov, camera distance AND viewport height. It must change ONLY on a user dolly/fit; never on a click,
			// focus, data feed, or a column-open resize. A canvas-height change moves it even with fov/pos fixed.
			viewport: this.camera.zoomMetric(),
			// Visibility: the fraction of nodes whose world position projects inside the canvas (NDC within [-1,1], in front
			// of the camera). 1 = the whole graph is framed; a low value means the camera is not framing the graph (the
			// "rendered but nothing visible" failure). Computed through the real camera projection, so it tracks any fov/dolly.
			onScreen: (() => {
				const T = aframeThree();
				const cam = this.fgCamera as unknown as { updateMatrixWorld?: (force?: boolean) => void } | undefined;
				if (!T || !cam || !this.fgCamera) return null;
				cam.updateMatrixWorld?.(true);
				let on = 0;
				let total = 0;
				let minX = Number.POSITIVE_INFINITY;
				let maxX = Number.NEGATIVE_INFINITY;
				let minY = Number.POSITIVE_INFINITY;
				let maxY = Number.NEGATIVE_INFINITY;
				for (const n of this.nodeMap.values()) {
					total++;
					const p = new T.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0) as unknown as { project(c: unknown): { x: number; y: number; z: number } };
					const v = p.project(this.fgCamera);
					if (ndcOnScreen(v) && v.z <= NDC_EDGE) on++;
					if (v.z <= NDC_EDGE) {
						minX = Math.min(minX, v.x);
						maxX = Math.max(maxX, v.x);
						minY = Math.min(minY, v.y);
						maxY = Math.max(maxY, v.y);
					}
				}
				// span: the graph's projected bounding box as a fraction of the viewport. A healthy frame fills a meaningful
				// share; a value near 0 is the "rendered but a tiny dot / nothing visible" failure.
				const span = total ? Math.max((maxX - minX) / NDC_SPAN, (maxY - minY) / NDC_SPAN) : 0;
				return { total, onScreen: on, fraction: total ? on / total : 1, span: Number.isFinite(span) ? span : 0 };
			})(),
			anchors: Object.fromEntries(this.enclosureCtl.anchors),
			enclosures: [...this.enclosureCtl.enclosures.entries()].map(([k, e]) => ({
				key: k,
				// The container's RESOLVED title (the party's display name under role mode, the @type under type mode) —
				// the ground truth a role-grouping test asserts the four trust-triangle containers are named correctly.
				title: e.label.text,
				x: e.box.position.x,
				y: e.box.position.y,
				z: e.box.position.z,
				sx: e.box.scale.x,
				sy: e.box.scale.y,
				sz: e.box.scale.z,
				labelPos: { x: e.label.position.x, y: e.label.position.y, z: e.label.position.z },
			})),
			gantt: this.renderType.axisLegend(),
			sample: nodes.slice(0, 80).map((n) => ({
				id: n.id,
				type: n.type,
				x: n.x,
				y: n.y,
				z: n.z,
				fx: n.fx ?? null,
				t: n.__t ?? null,
				degree: n.__degree ?? null,
				chip: n.__chipText ?? null,
				opacity: n.__visual?.opacity ?? null,
				k: n.__k ?? 1,
			})),
			// The resolved per-@type mark for each node — the headless render check: recomputed exactly as nodeObject
			// paints it (via markFor), so a Playwright test asserts a task paints as a "box" on a "time" role with its
			// duration zExtent and a plain node as a "chip"/"free", with no GPU.
			marks: nodes.slice(0, 80).map((n) => {
				const m = this.markFor(n);
				return { id: n.id, type: n.type, kind: m.kind, role: m.role.kind, zExtent: m.zExtent ?? null };
			}),
			// lineOpacity is the lib-APPLIED opacity (global linkOpacity × the rgba alpha from lineRgbaFor), read off the
			// live pooled material via the self-healing __lineObj handle — the ground truth a focus dim/highlight produced.
			edges: this.currentLinks.map((l) => ({
				s: linkEndId(l.source),
				t: linkEndId(l.target),
				lineOpacity: l.__lineObj?.material?.opacity ?? null,
				labelOpacity: l.__labelSprite?.material?.opacity ?? null,
			})),
		};
	}

	override render(): TemplateResult {
		const legend = this.renderType.axisLegend();
		return html`
			<style>
				shu-graph-scene { display: contents; }
				shu-graph-scene #polymorphic-info { position: absolute; bottom: var(--shu-space-5); left: var(--shu-space-5); z-index: 12; max-width: 70%; min-height: 20px; background: var(--shu-bg-elevated); padding: var(--shu-space-3) var(--shu-space-4); border-left: 3px solid var(--shu-accent); border-radius: var(--shu-radius); font-family: var(--shu-mono, monospace); font-size: var(--shu-font-sm); color: var(--shu-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				shu-graph-scene #polymorphic-info[hidden] { display: none; }
				/* Orbit compass: a minimal wire XYZ indicator in the upper-left, transparent to pointer events. */
				shu-graph-scene #polymorphic-compass { position: absolute; top: var(--shu-space-5); left: var(--shu-space-5); width: 72px; height: 72px; z-index: 9; pointer-events: none; opacity: 0.9; }
				/* Axis legend: shown only when the layout gives the axes meaning (gantt: x = time span, y = task rows). */
				shu-graph-scene #polymorphic-axis-legend { position: absolute; top: var(--shu-space-5); right: var(--shu-space-5); z-index: 10; pointer-events: none; background: var(--shu-bg-elevated); padding: var(--shu-space-2) var(--shu-space-4); border-right: 3px solid var(--shu-accent); border-radius: var(--shu-radius); font-family: var(--shu-mono, monospace); font-size: var(--shu-font-sm); color: var(--shu-fg); }
				shu-graph-scene #polymorphic-axis-legend .axis-row { display: flex; gap: var(--shu-space-2); align-items: baseline; }
				shu-graph-scene #polymorphic-axis-legend .axis-key { color: var(--shu-fg-muted); min-width: 3.5em; }
				/* Pin the scene/canvas to the column box and clip: A-Frame may size its buffer larger, but it can never overflow or push scrollbars. The rAF loop keeps the buffer+camera matched to this box (no stretch/blur). */
				shu-graph-scene #polymorphic-canvas { position: absolute; inset: 0; overflow: hidden; }
				/* Stacking as well as position: the VR lib treats its scene as fullscreen and gives the canvas a z-index of
				   its own, which painted it over every control on the page, the graph column's own header among them. */
				shu-graph-scene #polymorphic-canvas a-scene, shu-graph-scene #polymorphic-canvas canvas { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; z-index: 0 !important; display: block; }
				/* The guide: visually hidden until a keyboard reader tabs into it or the head's 🧭 opens it, then a
				   readable overlay panel — a focused entry must be visible (WCAG focus visible), not
				   clipped away. Both ways in land on the same shown state, so there is one appearance to maintain. */
				shu-graph-scene #polymorphic-a11y { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
				/* A reading is a document: its text selects and copies by hand. Each entry is also the way to that node,
				   so it is written as a link is — underlined, in the accent — rather than as a face that says nothing. */
				shu-graph-scene #polymorphic-a11y button { user-select: text; background: none; border: 0; padding: 0; margin: 0; font: inherit; text-align: left; color: var(--shu-accent); text-decoration: underline; cursor: pointer; }
				shu-graph-scene #polymorphic-a11y button:hover, shu-graph-scene #polymorphic-a11y button:focus-visible { text-decoration-thickness: 2px; }
				/* A marker is drawn in the list's own left padding, so the padding has to hold the widest one: at a fixed
				   step a two-digit line ran back over the region's edge. Sized in em, it holds three digits at any size. */
				shu-graph-scene #polymorphic-a11y ol { margin: 0; padding-left: 3em; }
				shu-graph-scene #polymorphic-a11y ul { margin: 0 0 var(--shu-space-1); padding-left: var(--shu-space-4); list-style: none; opacity: 0.85; }
				shu-graph-scene #polymorphic-a11y[data-shown] { user-select: text; }
				shu-graph-scene #polymorphic-a11y:focus-within, shu-graph-scene #polymorphic-a11y[data-shown] { width: auto; height: auto; clip-path: none; top: var(--shu-space-5); left: var(--shu-space-5); max-width: 70%; max-height: 80%; overflow: auto; z-index: 13; background: color-mix(in srgb, var(--shu-bg-elevated) 82%, transparent); backdrop-filter: blur(6px); padding: var(--shu-space-3) var(--shu-space-4); user-select: text; border-left: 3px solid var(--shu-accent); border-radius: var(--shu-radius); font-size: var(--shu-font-sm); color: var(--shu-fg); }
			</style>
			<div id="polymorphic-info" data-testid="polymorphic-info" hidden></div>
			<div id="polymorphic-canvas" data-testid=${SHU_TEST_IDS.POLYMORPHIC_VIEW.GRAPH_CONTAINER} aria-hidden="true"></div>
			<nav id="polymorphic-a11y" data-testid=${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y} aria-label="graph guide" ?data-shown=${this.config.readAsDocument}></nav>
			<canvas id="polymorphic-compass" aria-hidden="true"></canvas>
			${
				legend
					? html`<div id="polymorphic-axis-legend" data-testid="polymorphic-axis-legend">
							<div class="axis-row"><span class="axis-key">time</span><span>${legend.from} → ${legend.to}</span></div>
							<div class="axis-row"><span class="axis-key">rows</span><span>${legend.count} tasks</span></div>
						</div>`
					: ""
			}
		`;
	}

	protected override async onConnected(): Promise<void> {
		await this.updateComplete;
		this.infoEl = this.querySelector("#polymorphic-info");
		this.compassEl = this.querySelector<HTMLCanvasElement>("#polymorphic-compass");
		if (this.compassEl) {
			const dpr = window.devicePixelRatio || 1;
			this.compassEl.width = Math.round(72 * dpr);
			this.compassEl.height = Math.round(72 * dpr);
		}

		const container = this.querySelector<HTMLElement>("#polymorphic-canvas");
		if (!container) throw new Error("shu-graph-scene: #polymorphic-canvas not found");

		const VR = ForceGraphVR as unknown as new (el: HTMLElement) => FGInstance;
		this.graph = new VR(container);
		this.engine.attach(this.graph);
		this.configureGraph(this.graph);
		// One draw, two media: WebGL shows the graph, the accessible document reads it. The a11y entries drive the same
		// scene entries a pointer does (activate opens, focus highlights), so keyboard and pointer take one path.
		this.renderer ??= compositeRenderer(
			threeRenderer(this.graph, (n) => this.nodeObject(n)),
			new A11yRenderer({
				region: () => this.querySelector<HTMLElement>("#polymorphic-a11y"),
				bars: () => this.actorBars(),
				onActivate: (id) => this.openNode(id),
				onFocus: (id) => this.setHoveredNode(id),
			}),
		);
		this.renderer.rebuildNodes(); // the node factory reaches the library through the renderer, initially and on every shape change
		this.fitGraphFrame(container);

		this.autoTeardown(() => {
			if (this.repaintTimer !== undefined) clearTimeout(this.repaintTimer);
			if (this.layoutTimer !== undefined) clearTimeout(this.layoutTimer);
			if (this.fitFrameTimer !== undefined) clearTimeout(this.fitFrameTimer);
			for (const t of this.freshTimers) clearTimeout(t);
			this.clearGanttAxis();
			this.clearGanttGhost();
			this.enclosureCtl.dispose(); // boxes + the shared unit geometries (the gantt ghost reuses unitEdges but never disposes it)
			// Release the scene's WebGL context deterministically: a context otherwise frees only at GC, and past the
			// browser's concurrent-context cap the OLDEST context is silently lost — closed views must never be able to
			// take a live view's context with them.
			const r = this.fgRenderer as unknown as { dispose?: () => void; forceContextLoss?: () => void } | undefined;
			r?.dispose?.();
			r?.forceContextLoss?.();
		});

		const scene = container.querySelector("a-scene");
		// The VR lib sets embedded="" (falsy), so A-Frame's own resize() repeatedly sizes the canvas/camera to
		// document.body and clobbers our fit. A truthy value makes A-Frame size to the embedding element instead.
		scene?.setAttribute("embedded", "true");
		scene?.setAttribute("data-testid", SHU_TEST_IDS.POLYMORPHIC_VIEW.SCENE);
		scene?.querySelector("[camera]")?.setAttribute("data-testid", SHU_TEST_IDS.POLYMORPHIC_VIEW.CAMERA);
		// Plain HTTP (no secure context — e.g. http://<host>: dev): WebXR and the device sensors can't be granted, so
		// don't offer VR at all — no enter-VR button and no A-Frame "use HTTPS" alert. HTTPS keeps the full XR UI.
		if (!window.isSecureContext) {
			scene?.setAttribute("device-orientation-permission-ui", "enabled: false");
			scene?.setAttribute("xr-mode-ui", "enabled: false");
		}
		if (scene) scene.addEventListener("loaded", () => this.onSceneLoaded(scene as HTMLElement, container), { once: true });
	}

	/** Hand a node off to its @type presenter for a backend-neutral mark — the single place the calendar placement (the
	 *  bar's span) becomes presenter context. nodeObject paints it; inspect() reports it, so the headless render check
	 *  asserts exactly what's drawn. */
	private markFor(n: FGNode): NodeMark {
		const t = this.renderType.markTime(n.id); // the active view's calendar context for the presenter (a gantt bar's span); undefined → a point-in-time chip
		return presentationForType(n.type).mark(n, t ? { time: t } : {});
	}

	/** Build a node's 3D object: hand the node off to its @type presenter for a backend-neutral mark, then paint it for
	 *  the polymorphic view. The presenter decides shape/colour/label/role; this view supplies only the medium config. */
	private nodeObject(n: FGNode): unknown {
		// The per-node build is timed into the profiler's label total — its canvas raster + GPU texture upload is the
		// dominant per-node cost when the per-type limit is raised (the profiler step reads the accumulated split).
		return this.profiler.node(() => {
			const mark = this.markFor(n);
			// The common instance node (a "chip") renders as an SDF glyph-atlas chip (troika) — dark text on a solid
			// type-coloured background, all labels sharing one atlas texture and one background geometry, so a node costs
			// no per-node canvas raster + GPU texture upload. Other marks (the gantt box, the ontology lozenge/square)
			// keep the three-spritetext paint — they are few, and the box carries its label as a child. The billboard
			// frame job keeps the chips facing the camera. fontSize is the WORLD text height (chipTextHeight), as SpriteText's.
			// "Label as z factor" labels each chip with the value that places its depth — the date under a time basis, the
			// connection count under connections — so the z factor reads straight off the graph. Off (or no value), the usual label.
			const chipLabel = (this.labelAsZ ? this.zFactor(n).chip : undefined) ?? mark.label;
			n.__chipText = chipLabel; // what the chip says, so a reader of inspect() sees what was drawn
			// Every mark is built highlight-capable and the FOCUS pass glows the active node (visual.setHighlighted), so
			// the highlight follows the selection without rebuilding a single object. A drag-pin carries no highlight: a
			// pin is a position the reader chose, not a state to advertise, and the pin set persists across queries, so
			// highlighting pins would mark nodes unrelated to what is being read.
			const visual =
				mark.kind === "chip"
					? makeTroikaChip(chipLabel, mark.color, aframeThree() as unknown as ChipThree, {
							fontSize: chipTextHeight(mark),
							renderOrder: NODE_RENDER_ORDER,
							textColor: this.chipTextColor,
							borderColor: NODE_BORDER_COLOR,
							highlightColor: this.activeHighlightColor,
							avatar: typeAvatar(mark.type),
						})
					: spriteVisual(
							paintMarkScene(mark, {
								three: aframeThree(),
								makeLabel: (text, h, c) => new SpriteText(text, h, c) as unknown as ShapeLabel,
								textColor: this.chipTextColor, // on a chip: dark on the light type colour
								sceneTextColor: this.sceneTextColor, // off a chip (box label): foreground on the scene bg
								borderColor: NODE_BORDER_COLOR,
								fontSize: NODE_FONT_SIZE,
								renderOrder: NODE_RENDER_ORDER,
								headerLabel: this.renderType.capsNodeLabels,
							}) as unknown as Parameters<typeof spriteVisual>[0],
							{ three: aframeThree() as unknown as GlowThree, color: this.activeHighlightColor, renderOrder: NODE_RENDER_ORDER - 1 },
						);
			const obj = visual.object;
			n.__visual = visual;
			visual.setHighlighted(n.id === this.activeSubject); // a rebuilt object re-wears the glow if it is the active node
			n.__sprite = obj as unknown as TSprite;
			n.__baseScale = { x: obj.scale.x, y: obj.scale.y };
			n.__k = 1;
			return obj;
		});
	}

	/** Zero the render profiler so the next window (e.g. one per-type-limit change) is measured in isolation. */
	resetProfile(): void {
		this.profiler.reset();
	}

	/** Orient the node visuals to face the camera (each visual billboards itself — a troika chip group turns, a native
	 *  sprite is a no-op). Runs every frame (no camera-turn guard): troika builds a chip's geometry on a LATER frame than
	 *  its graphData feed, so a guarded pass would leave a just-built chip in its default orientation until the next camera
	 *  turn — the tilted-label bug. The cost is one in-place quaternion copy per chip (no allocation — the earlier drag lag
	 *  was a per-frame ALLOCATION here, since removed); nodeMap is the live set, so no separate registry leaks. */
	private billboardLabels(): void {
		const q = (this.fgCamera as unknown as { quaternion?: { x: number; y: number; z: number; w: number } })?.quaternion;
		if (!q) return;
		for (const n of this.nodeMap.values()) n.__visual?.faceCamera(q);
	}

	private configureGraph(g: FGInstance): void {
		g.nodeLabel((n) => n.name)
			// The lib derives line opacity from the global linkOpacity × the colour's alpha and pools materials by
			// colour — so focus dim/highlight is carried ENTIRELY in the rgba the accessor returns (see lineRgbaFor). Global
			// opacity is 1 so the per-edge alpha is the sole driver; re-calling linkColor on focus change re-pools
			// without rebuilding objects or reheating the layout. No mesh handles, no per-link material clones.
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
				const s = new SpriteText(l.predicate, EDGE_LABEL_TEXT_HEIGHT, this.edgeLabelColor);
				const sprite = s as unknown as TSprite;
				sprite.renderOrder = EDGE_LABEL_RENDER_ORDER;
				l.__labelSprite = sprite;
				return s;
			})
			.linkPositionUpdate((obj, { start, end }, link) => {
				const sprite = obj as TSprite;
				// The lib sets the link GROUP's renderOrder to 10, and three.js uses a group's renderOrder as the
				// children's groupOrder — the PRIMARY sort key — so links would always paint over the node chips
				// (groupOrder 0) no matter what the sprites' own flags say. Zero it; the secondary renderOrder then
				// layers line (0) → edge label (15) → node chip (20), back to front.
				if (sprite.parent && sprite.parent.renderOrder !== 0) sprite.parent.renderOrder = 0;
				if (sprite.parent?.children) link.__lineObj = sprite.parent.children[0]; // refresh every tick — read-only handle for inspect()/tests; never cached-once, so never stale
				const mid = link.__curve ? link.__curve.getPoint(0.5) : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 };
				sprite.position.set(mid.x, mid.y, mid.z);
			})
			.onEngineStop(() => {
				this.engine.engineStopped(); // the governor records that the engine rests
				this.camera.autoFitOnSettle(!!this.tween); // keep the spreading graph framed (growth-gated); the controller owns the policy
				// Release the temporary data-feed pins now the settle has come to rest: existing nodes held still
				// through the reheat (no jitter), and the resting layout is not left permanently frozen.
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
				if (this.hoverSubject || this.selectedSubject) this.requestFocusAtRest();
				// After a data settle (not a layout solve — those tween independently), draw enclosures and run the settle
				// hook (queued re-aim + gantt ruler) on the frame the nodes came to rest, not while they were still moving.
				if (!this.tween) {
					if (this.groupingActive()) requestAnimationFrame(() => this.enclosureCtl.updateEnclosureGeometry());
					this.onLayoutSettled();
				}
			})
			.showNavInfo(false) // its "Mouse drag: look" text describes the controls we replaced
			.numDimensions(2) // matches the scene's own 2D placement; the lib sim has no forces, so it never decides positions
			.warmupTicks(0) // no synchronous main-thread block in the digest — placement already ran (layoutForFeed)
			.cooldownTicks(120)
			// Node clicks are handled by OUR canvas click listener via pickNodeAt (the same authoritative press-time
			// pick the drag uses), NOT the lib's onNodeClick — that raycaster fires unreliably (and a stale post-drag
			// click-swallow made it miss after several focus switches). One reliable pick, no swallow flag.
			.onNodeHover((n) => {
				// Phantom-hover guards: during a layout tween, a drag, or a data-feed SETTLE, nodes pass UNDER the cursor
				// (the graph is still moving); and when the pointer isn't over the canvas at all, the cursor raycasts a
				// stale position every frame. All would jump focus to nodes the user never pointed at — honor hover only
				// from a live pointer over a graph at rest. (The programmatic setHoveredNode test interface is NOT gated.)
				if (this.tween || this.nodeDrag.dragging || !this.pointerOverCanvas || this.engine.mode === "settling") return;
				this.hoverSubject = n?.id ?? null;
				this.updateHoverInfo(n ?? null);
				this.focusCtl.applyFocus();
			});
	}

	/**
	 * The scene's own placement for this feed. A fresh layout each time, because d3 caches each force's accessor at
	 * initialize — the anchors and lane targets refresh only through re-registration. z is assigned from data in
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
	 * one has no velocity and stays put. Where the nodes go is decided before the feed (layoutForFeed), never by the
	 * library — which is what lets any renderer display the same positions.
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
			const c = n.__degree ?? 0;
			return { display: `${c} connections`, chip: `${c}` };
		}
		if (n.__t === undefined) return { display: "no recorded time", chip: undefined };
		const date = formatDate(new Date(n.__t).toISOString());
		return { display: `${n.__tField ?? LinkRelations.GENERATED_AT_TIME.rel} ${date}`, chip: date };
	}

	/** Essentials for the node under the pointer, overlaid above the controls: label · type · what its depth encodes. */
	private updateHoverInfo(n: FGNode | null): void {
		const el = this.infoEl;
		if (!el) return;
		if (!n || n.isCluster) {
			el.hidden = true;
			return;
		}
		// Ontology terms are timeless, so the z/time factor is meaningless for them: show the vocabulary a Property belongs
		// to (haibun's own vs a standard's prefix) and whether the type's data uses it, in place of the time.
		el.textContent = isSchemaType(n.type) ? this.schemaHoverText(n) : `${n.name} · ${n.type} · ${this.zFactor(n).display}`;
		el.hidden = false;
	}

	/** Hover text for a schema node: a Class shows its label; a Property shows its vocabulary (haibun's own or a standard's
	 *  prefix, from its IRI) and whether the type's data exercises it — a term a standard declares but the data never uses
	 *  reads "declared", distinguishing the full vocabulary from the properties actually present. */
	private schemaHoverText(n: FGNode): string {
		if (n.type !== ONTOLOGY_PROPERTY) return `${n.name} · ${n.type}`;
		const uri = String(n.properties?.uri ?? "");
		const vocab = uri ? propertyVocabulary(uri).prefix : ONTOLOGY_PROPERTY;
		const status = n.properties?.inData === false ? "declared" : "in data";
		return `${n.name} · ${vocab} · ${status}`;
	}

	/** Re-bind the node-three-object accessor with a fresh reference so three-forcegraph drops its cached __threeObj and
	 *  rebuilds EVERY node object on the next graphData feed — the only way the lib re-runs the shape factory for nodes
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
		const tasks = quadsToGanttModel(this.pipeline.renderableQuads(), { relOf: browserRelOf }).tasks;
		const dragged = tasks.find((t) => t.id === node.id);
		if (!dragged) return;
		// Time is the z axis: the dropped bar's new centre z maps back to its start (ganttBarTimes is the 1D inverse). The
		// drag sets node.z directly (the 2D sim ignores fz), so read z — the bar's actual rendered position.
		const newStartMs = Date.parse(ganttBarTimes(node.z, target.zLen, scale).startedAtTime);
		// Dragging a bar reschedules it AND slides every task that depends on it by the same delta.
		const shifted = cascadeReschedule(node.id, newStartMs - dragged.start, tasks);
		const updates: RescheduleUpdate[] = [...shifted].map(([id, { start, end }]) => ({
			label: node.type,
			id,
			data: JSON.stringify({ startedAtTime: new Date(start).toISOString(), endedAtTime: new Date(end).toISOString() }),
		}));
		if (updates.length === 0) return;
		// The host persists each vertex + refetches, then calls flushRepaint() so the rescheduled bars redraw at once.
		this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.RESCHEDULE_REQUEST, { detail: { updates }, bubbles: true, composed: true }));
	}

	/** Cancel the queued streamed-data repaint and repaint now — the host calls this after a reschedule's refetch lands so
	 *  the rescheduled bars and their edges redraw immediately rather than after the trailing coalesce. */
	flushRepaint(): void {
		if (this.repaintTimer !== undefined) {
			clearTimeout(this.repaintTimer);
			this.repaintTimer = undefined;
		}
		this.repaint();
	}

	private onSceneLoaded(scene: HTMLElement, container: HTMLElement): void {
		// Re-attach the governor to the INNER three-forcegraph instance: its pacing props apply synchronously,
		// where the VR wrapper forwards them through two debounced digests (a cooldown set from inside the engine's
		// stop callback would land frames late and the engine would re-stop on the stale value). The wrapper attach
		// at construction covers only the pre-scene boot window.
		const fgEl = scene.querySelector("[forcegraph]") as (Element & { components?: { forcegraph?: { forceGraph?: TPacedGraph } } }) | null;
		const inner = fgEl?.components?.forcegraph?.forceGraph;
		if (!inner) throw new Error("shu-graph-scene: inner forcegraph instance unavailable at scene load");
		this.engine.attach(inner);
		// Re-assert after load: A-Frame may swap in its own camera entity during scene init.
		scene.querySelector("[camera]")?.setAttribute("data-testid", SHU_TEST_IDS.POLYMORPHIC_VIEW.CAMERA);
		this.enableSpriteRaycast(scene);
		this.attachControls(scene);
		this.removeLibraryForces();
		this.applyTheme();
		// Own the size end-to-end: the lib's wrapper frame (fitGraphFrame) plus the drawing buffer + camera. A genuine
		// resize takes the fov-preserving path (onContainerResize); the rAF watchdog re-asserts aspect-only
		// (syncViewport) so an A-Frame body-sized resize can't persist OR slip in a zoom.
		const sized = scene as unknown as HTMLElement & {
			renderer?: TSceneRenderer;
			camera?: TSceneCamera;
			emit(name: string, detail?: unknown, bubbles?: boolean): void;
		};
		this.fgRenderer = sized.renderer;
		this.fgCamera = sized.camera;
		this.fgCanvas = container.querySelector("canvas") ?? undefined;
		this.fgContainer = container;
		this.fgSceneEl = sized;
		this.attachNodeDrag();
		this.fitGraphFrame(container);
		this.camera.onContainerResize();
		const observer = new ResizeObserver(() => {
			this.markDirty(); // a paused scene must wake to re-fit and redraw on a container resize
			this.fitGraphFrame(container);
			this.camera.onContainerResize();
		});
		observer.observe(container);
		this.autoTeardown(() => observer.disconnect());
		// Re-theme when the OS colour scheme flips (auto mode) or the user picks a theme (data-theme on <html>).
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onSchemeChange = () => this.applyTheme();
		media.addEventListener("change", onSchemeChange);
		this.autoTeardown(() => media.removeEventListener("change", onSchemeChange));
		const themeObserver = new MutationObserver(() => this.applyTheme());
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		this.autoTeardown(() => themeObserver.disconnect());
	}

	/**
	 * The lib wraps the scene in its own position:relative div sized by its width/height props, which DEFAULT TO
	 * WINDOW SIZE — the scene then displays at that size regardless of the column (the measured stretch/blur).
	 * Keep that frame matched to the column via the lib's own width()/height() API.
	 */
	private fitGraphFrame(container: HTMLElement): void {
		// Trailing debounce: column open/close animates over many frames; firing on each pixel causes viewport
		// jitter as the lib resizes the renderer. Wait for the animation to settle, then apply the final size.
		clearTimeout(this.fitFrameTimer);
		this.fitFrameTimer = window.setTimeout(() => {
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (w && h) this.renderer?.size(w, h);
			// Following holds the chosen node where the reader can see it, and a resize moves where that is: the first
			// click's own column-open narrows the canvas right after the follow aimed at the wide one, which left the
			// followed node beyond the new edge. Re-assert the aim against the settled box — and only where the resize
			// actually lost the node, so a resize never undoes a pan that left it deliberately in view.
			if (this.config.follow && this.activeSubject && !this.onCanvas(this.activeSubject)) this.followActive(this.activeSubject);
		}, 100);
	}

	/** Whether a node currently projects inside the canvas box — the "can the reader still see it" test a resize asks. */
	private onCanvas(id: string): boolean {
		const at = this.projectNodeToScreen(id);
		const rect = this.ctx.canvas?.getBoundingClientRect();
		if (!at || !rect) return true; // no projection yet — nothing to correct
		return at.x >= rect.left && at.x <= rect.right && at.y >= rect.top && at.y <= rect.bottom;
	}

	/**
	 * A-Frame's mouse cursor caches the canvas bounds, refreshed only on window resize/scroll or a DEBOUNCED
	 * (500ms) rendererresize handler — both miss column-level layout changes, and the debounce can be starved by
	 * recurring layout shifts (an open actions bar), leaving picks permanently offset. Write the fresh rect into
	 * the cursor components directly; emit rendererresize too for anything else listening.
	 */
	private refreshPickBounds(): void {
		const scene = this.ctx.sceneEl;
		const canvas = this.ctx.canvas;
		if (!scene || !canvas) return;
		const bounds = canvas.getBoundingClientRect();
		type CursorEl = HTMLElement & { components?: { cursor?: { canvasBounds: DOMRect } } };
		for (const el of Array.from(scene.querySelectorAll<CursorEl>("[cursor]"))) {
			const cursor = el.components?.cursor;
			if (cursor) cursor.canvasBounds = bounds;
		}
		scene.emit("rendererresize", null, false);
	}

	/**
	 * Cheap geometry watchdog, sampled every 15 frames from the rAF tick (per-frame layout reads would force a
	 * synchronous layout flush 60×/s for the component's lifetime). Re-asserts the buffer size aspect-only via
	 * syncViewport (an A-Frame body-sized resize must not persist) — NEVER the fov-preserving resize path, so it
	 * cannot rescale the graph — and refreshes the cursor's cached pick bounds when the canvas merely MOVES — strip
	 * scrolled sideways, a column opened/closed, the actions bar — which fires neither ResizeObserver (size
	 * unchanged) nor A-Frame's window listeners (inner scroller). Integer-pixel comparison so subpixel layout jitter
	 * doesn't refresh in a loop. Real container resizes are handled immediately by the ResizeObserver (the fov path).
	 */
	private checkCanvasGeometry(): void {
		this.camera.syncViewport();
		const canvas = this.ctx.canvas;
		if (!canvas) return;
		const b = canvas.getBoundingClientRect();
		const r = { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) };
		const prev = this.lastCanvasPos;
		if (prev && (prev.left !== r.left || prev.top !== r.top || prev.width !== r.width || prev.height !== r.height)) {
			this.refreshPickBounds();
			this.markDirty(); // a resize needs a redraw at the new aspect; a pure move only needs the bounds, but waking is harmless
		}
		this.lastCanvasPos = r;
	}

	private themeColor(token: string, fallback: string): string {
		const v = getComputedStyle(this).getPropertyValue(token).trim();
		return v || fallback;
	}

	/**
	 * Wire orbit compass: projects the three world axes (x, y, t=time/z) through the live camera orientation
	 * and draws them on the small upper-left canvas. Back-facing arms render as faint dashes; front-facing as
	 * solid lines with dots. matrixWorld columns (col-major): right=[0,1,2], up=[4,5,6], back=[8,9,10].
	 * Screen: sx = dot(axis, right), sy = -dot(axis, up) [Y flipped]; depth = -dot(axis, back).
	 */
	private drawCompass(): void {
		const canvas = this.compassEl;
		const m = this.ctx.camera?.matrixWorld?.elements;
		if (!canvas || !m || canvas.width === 0) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const W = canvas.width / dpr;
		const H = canvas.height / dpr;
		ctx.save();
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, W, H);
		const cx = W / 2;
		const cy = H / 2;
		const R = W * 0.28; // shorter arm → room for labels within the canvas without a backdrop disc
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
			// Positive arm
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
		this.focusTextPx = Number.parseFloat(this.themeColor("--shu-font-md", "13px")) || 13;
		this.compassFgColor = this.themeColor("--shu-fg", "#e0e0e0");
		this.compassAccentColor = this.themeColor("--shu-accent", "#4ac080");
		this.compassDimColor = this.themeColor("--shu-fg-faded", "#666");
		this.graph?.backgroundColor(this.themeColor("--shu-bg", "#ffffff"));
		this.graph?.linkColor((l) => this.focusCtl.lineRgbaFor(l)); // re-pool line materials under the new theme colours
		this.graph?.linkDirectionalArrowColor((l) => this.focusCtl.lineRgbaFor(l)); // arrows follow the same line rgba
		// Label sprites keep their construction-time colour; recolour them in place — a graphData re-feed would
		// reheat the layout (and the unchanged-model skip would suppress it anyway, leaving labels bg-on-bg).
		for (const l of this.currentLinks) if (l.__labelSprite) l.__labelSprite.color = this.edgeLabelColor;
		this.enclosureCtl.recolorLabels(this.edgeLabelColor);
		if (this.focusId) this.focusCtl.applyFocus(); // re-assert focus colours under the new theme
		this.markDirty();
	}

	/** Wake the on-demand render loop for the next `DIRTY_GRACE_FRAMES` frames, so a discrete change (data, selection,
	 *  resize, theme) is drawn rather than slept through. Continuous motion keeps itself awake via `isSettling`. */
	private markDirty(grace = DIRTY_GRACE_FRAMES): void {
		this.dirtyUntilFrame = Math.max(this.dirtyUntilFrame, this.rafFrame + grace);
	}

	/** Ask the render loop to (re)apply the active focus once the layout is at rest and the node visuals exist.
	 *  `focusDirty` keeps the loop awake until a frozen frame applies it; the `markDirty` grace keeps it drawing a while
	 *  longer, covering the case where a node's visual lags past the freeze frame so the next pass catches it. */
	private requestFocusAtRest(): void {
		this.focusDirty = true;
		this.markDirty();
	}

	/** True while an animation is still in motion: the force layout settling, a layout tween, or a node drag. Camera
	 *  damping, discrete changes and the active node's breathing glow wake the loop through `markDirty`; the pointer
	 *  over the canvas keeps it awake for hover. */
	private isSettling(): boolean {
		return this.engine.mode !== "frozen" || this.tween != null || this.nodeDrag.dragging;
	}

	/**
	 * Desktop navigation: drag pans, Ctrl+drag spins, wheel zooms. A-Frame's look/wasd/movement controls
	 * are removed and the camera rig is flattened to the origin so OrbitControls operates in world space;
	 * it's disabled inside a VR session, where WebXR drives the camera.
	 */
	private attachControls(scene: HTMLElement): void {
		const aScene = scene as unknown as { camera: { position: { set(x: number, y: number, z: number): void } }; renderer: { domElement: HTMLCanvasElement } };
		const cameraEl = scene.querySelector("[camera]");
		const rigEl = scene.querySelector("[movement-controls]");
		if (!cameraEl || !aScene.camera || !aScene.renderer?.domElement) throw new Error("shu-graph-scene: camera/renderer unavailable for controls");
		cameraEl.removeAttribute("look-controls");
		cameraEl.removeAttribute("wasd-controls");
		// Disable rather than remove: movement-controls' own loaded/tick handlers still run and crash on a removed component.
		(rigEl as unknown as { setAttribute(component: string, prop: string, value: unknown): void } | null)?.setAttribute("movement-controls", "enabled", false);
		// Flatten the rig to the origin and carry the view distance on the camera itself, so OrbitControls —
		// which reads/writes `scene.camera` (the PerspectiveCamera) — operates directly in world space.
		rigEl?.setAttribute("position", "0 0 0");
		aScene.camera.position.set(0, 0, 300);

		const controls = new OrbitControls(aScene.camera, aScene.renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.12;
		controls.screenSpacePanning = true;
		controls.mouseButtons = { LEFT: ORBIT_PAN, MIDDLE: 1, RIGHT: ORBIT_ROTATE };
		this.controls = controls;
		// Camera motion — a drag/zoom and the damping that eases out after the pointer releases — wakes the on-demand loop.
		// `change` fires each frame the camera still moves, so the scene keeps drawing through the damping, then idles.
		const controlEvents = controls as unknown as { addEventListener(type: "start" | "change", listener: () => void): void };
		controlEvents.addEventListener("start", () => this.markDirty());
		controlEvents.addEventListener("change", () => this.markDirty(4));
		const canvas = aScene.renderer.domElement;
		let downAt: { x: number; y: number } | null = null;
		// Ctrl/meta/shift-to-orbit is OrbitControls' OWN behavior: with LEFT mapped to PAN, a modified press
		// rotates (see OrbitControls' MOUSE.PAN case). Never pre-flip mouseButtons from key events — that double-
		// inverts the lib's handling and the modifier goes dead.
		const onPointerDown = (e: PointerEvent) => {
			downAt = { x: e.clientX, y: e.clientY };
		};
		// One reliable click path for the whole canvas: a press that did not move (a pan/orbit/drag moved past the
		// threshold and is skipped) re-picks the node under the cursor with pickNodeAt — the SAME authoritative pick the
		// drag uses — and opens its column (carrying ctrl/meta/shift for add-to-selection). Empty space clears focus.
		// This replaces the lib's flaky onNodeClick, so repeated node/column focus switches stay reliable.
		const onClick = (e: MouseEvent) => {
			const moved = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_THRESHOLD_PX;
			downAt = null;
			if (moved) return;
			const node = this.pickNodeAt(e);
			if (node) this.onNodeClick(node, e);
			else if (this.selectedSubject) publishSelection(null, null); // clear the app-wide selection; the host relays it back via setSelectedSubject
		};
		canvas.addEventListener("pointerdown", onPointerDown);
		canvas.addEventListener("click", onClick);
		this.autoTeardown(() => {
			canvas.removeEventListener("pointerdown", onPointerDown);
			canvas.removeEventListener("click", onClick);
		});

		// The frame's jobs, declared with their cadences in one place (see FrameScheduler).
		this.frame.add("controls", () => controls.update());
		this.frame.add("compass", () => this.drawCompass(), 2);
		this.frame.add("retarget-magnify", () => this.focusCtl.retargetMagnify(), 15);
		this.frame.add("magnify", () => this.focusCtl.updateMagnify());

		this.frame.add("billboard", () => this.billboardLabels()); // troika labels are meshes — orient them to the camera each frame
		this.frame.add("layout-tween", () => this.updateLayoutTween());
		// Track the group containers on a throttled cadence WHILE the layout is settling, so they form and follow the
		// nodes instead of popping in only at full stop (a large graph's settle is otherwise a long wait). Nodes are
		// anchor-seeded with real positions from the first frame, so there is no z=0 flash to sample into; the final
		// draw still lands on onEngineStop. Skipped once frozen, while a node is being dragged (the drag owns the pins),
		// and when grouping is off.
		this.frame.add(
			"enclosure-track",
			() => {
				if (this.groupingActive() && this.engine.mode !== "frozen" && !this.nodeDrag.dragging) this.enclosureCtl.updateEnclosureGeometry();
			},
			8,
		);
		const aframeScene = scene as unknown as { pause?(): void; play?(): void };
		// Render on demand: run the frame jobs and let A-Frame draw only while something is moving (layout settle, tween,
		// drag, camera damping via the `change` listener), the pointer is over the canvas, or a recent discrete change is
		// still within its grace window. Otherwise pause the scene so an idle graph stops consuming a core. The rAF loop
		// itself keeps running — the gate is a cheap per-frame check — so a change wakes the scene within one frame.
		const tick = () => {
			this.rafFrame++;
			// A wake detector, not a render job: the canvas can MOVE (strip scroll, column shift) without resizing, which no
			// observer catches, so this cheap poll runs even while the scene is paused and marks dirty on any geometry change.
			if (this.rafFrame % CANVAS_GEOMETRY_EVERY === 0) this.checkCanvasGeometry();
			// The active node's breath, sampled on WALL frames like the geometry poll rather than as a frame job: a job's
			// countdown only advances while the scene is drawing, so a throttled breath stalled whenever the scene
			// settled and then jumped. One node's colour and scale, ten times a second, and the frame it asks for is the
			// only one it costs — the scene still idles between them.
			if (this.rafFrame % BREATH_EVERY === 0 && this.focusCtl.updateHighlight()) this.markDirty(1);
			// A pending focus keeps the scene awake until it can be applied: applyFocus needs the layout at rest (its pin +
			// sim tick would spring an under-converged graph) and the node visuals built (it skips a node with no visual
			// yet), and either can lag a selection made mid-build. Sleeping before then would leave the dim undrawn.
			const active = this.rafFrame < this.dirtyUntilFrame || this.pointerOverCanvas || this.isSettling() || this.focusDirty;
			if (active) {
				if (this.scenePaused) {
					aframeScene.play?.();
					this.scenePaused = false;
				}
				if (this.focusDirty && this.engine.mode === "frozen") {
					this.focusCtl.applyFocus();
					this.focusDirty = false;
				}
				this.frame.tick();
			} else if (!this.scenePaused) {
				aframeScene.pause?.();
				this.scenePaused = true;
			}
			this.rafHandle = requestAnimationFrame(tick);
		};
		this.rafHandle = requestAnimationFrame(tick);
		this.autoTeardown(() => {
			if (this.rafHandle !== undefined) cancelAnimationFrame(this.rafHandle);
			controls.dispose();
		});

		const setEnabled = (on: boolean) => {
			controls.enabled = on;
		};
		scene.addEventListener("enter-vr", () => setEnabled(false));
		scene.addEventListener("exit-vr", () => setEnabled(true));
	}

	/** A pointer ray through the camera at the event's canvas position, usable for plane hits and sprite picks. */
	private pointerRay(e: MouseEvent): InstanceType<ThreeNs["Raycaster"]> | null {
		const T = aframeThree();
		const canvas = this.ctx.canvas;
		const cam = this.ctx.camera;
		if (!T || !canvas || !cam) return null;
		// Raycast from a CURRENT camera matrix. A pick can run between render frames — after a fit reframe nothing has
		// repainted the camera's matrixWorld yet — so setFromCamera would build the ray from a stale matrix and miss every
		// sprite. `projectNodeToScreen` forces the same for the symmetric projection; the pick must match or the two disagree.
		(cam as { updateMatrixWorld?: (f?: boolean) => void }).updateMatrixWorld?.(true);
		const n = clientToNdc({ x: e.clientX, y: e.clientY }, canvas.getBoundingClientRect());
		const ndc = new T.Vector2(n.x, n.y);
		const ray = new T.Raycaster();
		ray.setFromCamera(ndc, cam);
		ray.camera = cam; // Sprite.raycast needs the camera reference (billboard math)
		return ray;
	}

	/** Where the pointer ray meets the given plane, in graph/world coordinates. null when the ray misses (grazing angle). */
	private pointerPlaneHit(e: PointerEvent, plane: DragPlane): Vec3 | null {
		const T = aframeThree();
		const ray = this.pointerRay(e);
		return T && ray ? ray.ray.intersectPlane(plane, new T.Vector3()) : null;
	}

	/** The node whose chip is under the pointer — a fresh press-time raycast, so a drag/orbit decision never waits on
	 * the cursor component's per-frame hover. Picks against the chip's RESTING footprint, not its magnified halo:
	 * the focus pop is purely visual and must never inflate the clickable area (a 6× focused chip would otherwise
	 * swallow every orbit press around it — the "focused node blocks the graph" bug). */
	private pickNodeAt(e: MouseEvent): FGNode | undefined {
		const ray = this.pointerRay(e);
		if (!ray) return undefined;
		const spriteToNode = new Map<unknown, FGNode>();
		const sprites: unknown[] = [];
		const restore: Array<[TPickObject, TScaleRestore]> = [];
		for (const n of this.ctx.nodeMap.values()) {
			const s = n.__sprite as
				| (TSprite & { position?: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }; updateMatrixWorld?: (f?: boolean) => void })
				| undefined;
			if (!s) continue;
			// Raycast the visual's pick target — a troika chip's background quad (the geometry-less group can't be hit),
			// a sprite/mesh is itself. Its world matrix follows the object's, so the transform writes below (on the object,
			// n.__sprite) still position the pick target.
			const target = (n.__visual?.pickTarget ?? s) as unknown;
			if (!target) continue;
			sprites.push(target);
			spriteToNode.set(target, n);
			// Raycast against WHERE THE NODE IS (the engine's coordinates) at its resting size, with the matrix re-derived —
			// the object-side twin of pointerRay's forced camera matrix, and the same all-nodes-miss symptom when it is
			// skipped. Writes are what the next render tick would do anyway: idempotent and paint-invisible.
			const magnified = syncPickTarget(s as TPickObject, { x: n.x, y: n.y, z: n.z, baseScale: n.__baseScale });
			if (magnified) restore.push([s as TPickObject, magnified]);
		}
		const hit = ray.intersectObjects(sprites, false)[0];
		for (const [s, scale] of restore) restorePickTarget(s, scale);
		return hit ? spriteToNode.get(hit.object) : undefined;
	}

	/**
	 * Drag a node aside (it sometimes blocks a more important one): pointerdown on a node starts a drag in
	 * the camera-facing plane through it. Every OTHER node is pinned for the duration so nothing else moves — only
	 * the dragged node follows the pointer, links tracking live. On release the dragged node's pin persists, so the
	 * cleared view holds until the next layout change re-solves the layout and releases every pin.
	 */
	/** The camera-facing plane through a node, fixed at press time — the surface the drag slides the node along. Null when
	 *  the GPU namespace or the camera isn't ready (headless), so the drag simply never starts. */
	private dragPlaneFor(node: FGNode): DragPlane | null {
		const T = aframeThree();
		const dir = T && this.ctx.camera?.getWorldDirection?.(new T.Vector3());
		if (!T || !dir) return null;
		const plane = new T.Plane();
		plane.setFromNormalAndCoplanarPoint(dir, new T.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0));
		return plane as DragPlane;
	}

	private attachNodeDrag(): void {
		const canvas = this.ctx.canvas;
		if (!canvas) return;
		const onDown = (e: PointerEvent) => {
			// Ctrl/meta is the CAMERA modifier: a modified press always orbits, even over a chip — otherwise a dense graph
			// leaves no pixel from which the camera can be rotated. A press during a tween or an active drag is ignored.
			if (e.button !== 0 || this.tween || this.nodeDrag.dragging || !this.graph) return;
			if (e.ctrlKey || e.metaKey) return;
			this.nodeDrag.down(e);
			if (this.nodeDrag.pendingId !== null) {
				try {
					canvas.setPointerCapture(e.pointerId); // keeps moves flowing outside the canvas; synthetic pointers (tests) have no capturable id
				} catch {
					/* drag still works, bounded to the canvas */
				}
			}
		};
		const onMove = (e: PointerEvent) => {
			// Any move over the canvas proves presence — pointerenter alone misses the page loading with the cursor already
			// over the canvas (no enter fires), which left hover and drag dead until a re-entry.
			this.pointerOverCanvas = true;
			this.nodeDrag.move(e);
		};
		const onUp = () => this.nodeDrag.up();
		// Pointer presence gates hover (see onNodeHover): entering enables it, leaving clears any active hover so a
		// dimmed neighbourhood can never outlive the pointer that caused it.
		const onEnter = () => {
			this.pointerOverCanvas = true;
		};
		const onLeave = () => {
			this.pointerOverCanvas = false;
			this.markDirty(); // draw the hover magnify easing back out after the pointer leaves
			this.updateHoverInfo(null);
			if (this.hoverSubject) {
				this.hoverSubject = null;
				this.focusCtl.applyFocus();
			}
		};
		// Capture phase: a press on a node must disable the controls BEFORE OrbitControls' own (earlier-attached)
		// pointerdown handler runs, or the press starts a pan and the node drag fights the camera for the gesture.
		canvas.addEventListener("pointerdown", onDown, true);
		canvas.addEventListener("pointermove", onMove);
		canvas.addEventListener("pointerup", onUp);
		canvas.addEventListener("pointercancel", onUp);
		canvas.addEventListener("pointerenter", onEnter);
		canvas.addEventListener("pointerleave", onLeave);
		this.autoTeardown(() => {
			canvas.removeEventListener("pointerdown", onDown, true);
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("pointerup", onUp);
			canvas.removeEventListener("pointercancel", onUp);
			canvas.removeEventListener("pointerenter", onEnter);
			canvas.removeEventListener("pointerleave", onLeave);
		});
	}

	/**
	 * A-Frame's raycaster aims by origin+direction and never sets its THREE.Raycaster.camera, but
	 * `Sprite.raycast` needs that reference (billboard math) — without it our SpriteText nodes throw.
	 * Point every cursor/laser raycaster at the active camera; harmless for the mesh/line objects.
	 */
	private enableSpriteRaycast(scene: HTMLElement): void {
		type RaycasterEl = HTMLElement & { components?: { raycaster?: { raycaster: { camera: unknown } } } };
		const sceneWithCamera = scene as unknown as { camera: unknown };
		const apply = (camera: unknown) => {
			for (const el of Array.from(scene.querySelectorAll<RaycasterEl>("[raycaster]"))) {
				const rc = el.components?.raycaster?.raycaster;
				if (rc) rc.camera = camera;
			}
		};
		apply(sceneWithCamera.camera);
		const onCameraSet = (e: Event) => apply((e as CustomEvent<{ cameraEl: { components: { camera: { camera: unknown } } } }>).detail.cameraEl.components.camera.camera);
		scene.addEventListener("camera-set-active", onCameraSet as EventListener);
		this.autoTeardown(() => scene.removeEventListener("camera-set-active", onCameraSet as EventListener));
	}

	private cursorPaintPending = false;
	/** The time cursor moved (the host has already refreshed model.visibleQuads + model.timeCursor before this call): re-style
	 *  promptly rather than through the streamed-data window, so a scrub isn't laggy. Deferred a tick out of the synchronous
	 *  cursor-notify stack — re-feeding graphData re-entrantly under the setter leaves the lib mid-update (a re-added node
	 *  settles off-frame). First-wins coalesce; the cursor repaint supersedes any queued streamed-data repaint. */
	setTimeCursorValue(_ms: number | null): void {
		if (this.cursorPaintPending) return;
		this.cursorPaintPending = true;
		setTimeout(() => {
			this.cursorPaintPending = false;
			if (this.repaintTimer !== undefined) {
				clearTimeout(this.repaintTimer);
				this.repaintTimer = undefined;
			}
			this.repaint();
		}, 0);
	}

	/** New/removed streamed nodes: short trailing coalesce so the newcomer shows promptly; positions are preserved (no scatter). */
	private scheduleData(): void {
		this.markDirty();
		if (this.repaintTimer !== undefined) return;
		this.repaintTimer = window.setTimeout(() => {
			this.repaintTimer = undefined;
			this.repaint();
		}, DATA_DEBOUNCE_MS);
	}

	/** A layout change (flatten/dag/group/type-filter): longer trailing coalesce so a burst of toggles collapses into one tween. */
	private scheduleLayout(): void {
		this.markDirty();
		if (this.layoutTimer !== undefined) clearTimeout(this.layoutTimer);
		this.layoutTimer = window.setTimeout(() => {
			this.layoutTimer = undefined;
			this.repaintLayout();
		}, LAYOUT_DEBOUNCE_MS);
	}

	private repaint(): void {
		// The scene boots asynchronously; a model set before the graph exists retries here once it has mounted.
		if (!this.graph) {
			this.scheduleData();
			return;
		}
		// A ghost tween or an active drag owns the layout — don't re-place under it; retry after. (A mid-drag merge
		// would re-run toGraphData and overwrite the dragged bar's live z back to its stored target.)
		if (this.tween || this.nodeDrag.dragging) {
			this.scheduleData();
			return;
		}
		this.invalidateModelCache(); // a fresh repaint: rebuild the model + seqNodes once, so the render-type caches re-key
		const firstFeed = this.lastModelHash === undefined; // the from-scratch layout (springy); later feeds are incremental clumps (damped)
		const existingIds = new Set(this.nodeMap.keys()); // before toGraphData rebuilds the map
		const { nodes, links, freshLinks } = this.profiler.compute(() => this.pipeline.toGraphData());
		// Re-feeding graphData reheats the layout (visible jitter) — skip entirely when the visible model is unchanged
		// (e.g. instrumentation-adjacent merges or a throttled window that brought nothing new). In gantt the time z is
		// part of the model, so a reschedule (same nodes/links, moved bars) is detected here and DOES repaint.
		const hash = this.pipeline.hashCurrentModel(nodes, links);
		if (hash === this.lastModelHash && !this.nodeRebuildPending) return; // a pending shape rebuild must still feed
		this.lastModelHash = hash;
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
		// Place before the feed: existing nodes are pinned above, so only newcomers move — from their seeds, damped, so a
		// streamed clump settles near where it belongs. The first feed places from scratch and rests at equilibrium, so a
		// later hover/focus repool moves an at-rest layout by zero. The renderer then only displays these positions.
		this.profiler.compute(() => this.layoutForFeed().place(nodes, links, { damped: !firstFeed }));
		this.engine.settle();
		if (this.nodeRebuildPending) this.forceNodeObjectRebuild(); // re-run the shape factory for every node this feed
		this.profiler.set(nodes.length, () => this.renderer?.draw({ nodes, links }));
		this.animateFreshLinks(freshLinks);
		// Re-assert any active focus once the lib has (re)built the sprites for the new data.
		if (this.hoverSubject || this.selectedSubject) this.requestFocusAtRest();
		this.applyEmbedScope();
	}

	// An embedded mount's requested scope (scopeToType with a focusType), applied in stages as the data arrives.
	private embedScope?: { focusType: string; revealed: boolean };

	/** Embedded mount (the host forwards a product's focusType): scope the view to the SCHEMA — only the Class + Property
	 *  chips visible — and frame it once it settles. The host controls the filter, so the reveal is emitted as
	 *  graph-scope-revealed; this owns only the camera. */
	scopeToType(focusType: string): void {
		this.embedScope = { focusType, revealed: false };
		this.applyEmbedScope();
	}

	/** Staged one-shots (the data lands over several repaints): first ask the host to show only the schema chips once the
	 *  clusters are known (emit graph-scope-revealed exactly once), then fit around the focus type's node once built. */
	private applyEmbedScope(): void {
		const scope = this.embedScope;
		if (!scope) return;
		if (!scope.revealed) {
			if (!this.model.knownClusters.has(ONTOLOGY_CLASS)) return;
			scope.revealed = true;
			this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.SCOPE_REVEALED, { detail: { types: [ONTOLOGY_CLASS, ONTOLOGY_PROPERTY] }, bubbles: true, composed: true }));
			return;
		}
		if (!this.nodeMap.has(scope.focusType)) return;
		this.embedScope = undefined;
		// Queued, not framed here: this runs on a repaint, with the feed's nodes still piled at the origin, so framing now
		// fits a bounding box barely bigger than one node and leaves the camera sitting on top of it. The camera applies a
		// queued reframe on the settle — the once-only frame, on the laid-out graph.
		this.camera.queueFrame(FRAME.front);
	}

	/** Emit the control-bar inputs the host renders: the group-by axes and paint options derived from the visible model,
	 *  whether the active view suppresses grouping, the node/edge counts, the latest step, and the axis legend. Also
	 *  refreshes this scene's own axis-legend chrome. */
	private emitSceneChanged(): void {
		const links = this.currentLinks;
		const omitted = this.model.clusters.reduce((s, c) => s + c.omittedCount, 0);
		const relTypes = new Set(links.map((l) => l.predicate)).size;
		const detail: GraphSceneChangedDetail = {
			groupByAxes: this.groupByAxes,
			forces: this.renderType.forces,
			paintOptions: availablePaints(this.model.visibleQuads),
			counts: { nodes: this.nodeMap.size, edges: links.length, relTypes, omitted },
			latestStep: this.computeLatestStep(),
			axisLegend: this.renderType.axisLegend(),
			pins: this.getUserPins(),
		};
		this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.SCENE_CHANGED, { detail, bubbles: true, composed: true }));
		this.requestUpdate(); // refresh the scene's own axis-legend chrome
	}

	/** The display label of the highest-timestamp SeqPath visible at the current time cursor, or null when none is visible. */
	private computeLatestStep(): string | null {
		const seqCluster = this.model.clusters.find((c) => c.type === "SeqPath");
		if (!seqCluster || seqCluster.sampledSubjects.length === 0) return null;
		const seqSubjects = new Set(seqCluster.sampledSubjects);
		let latestSubject: string | null = null;
		let latestTime = -Infinity;
		for (const q of this.model.visibleQuads) {
			if (!seqSubjects.has(q.subject) || q.timestamp <= latestTime) continue;
			latestTime = q.timestamp;
			latestSubject = q.subject;
		}
		if (!latestSubject) return null;
		return seqCluster.displayLabels[latestSubject] ?? latestSubject;
	}

	/**
	 * A layout change (flatten/dag/group/type-filter): rebuild the model, solve the FINAL layout off-screen, then
	 * glide every surviving node from where it is to where it lands over one eased tween — no physics churn, the
	 * one redraw the user asked for. New nodes (rare on a layout change) appear at their target.
	 */
	private repaintLayout(): void {
		if (!this.graph) return;
		this.parkedPositions.clear(); // layout changes move everything; parked positions would be stale
		this.linkMap.clear(); // layout rebuilds all link objects; old __lineObj refs point at orphaned meshes
		// Nothing to lay out yet (e.g. a persisted grouping restored before any data): bail rather than run an
		// empty solve — its engine-stop would consume the one-time initial warmup the FIRST real feed relies on.
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
		// and a pin against them silently misses — leaving members to the force, which spreads the boxes into each other.
		this.enclosureCtl.recomputeGroupAnchors([...this.nodeMap.values()]);
		const { nodes, links } = this.pipeline.toGraphData(true); // a deliberate re-place re-fits the depth scale to the new layout
		this.currentLinks = links;
		this.lastModelHash = this.pipeline.hashCurrentModel(nodes, links); // gantt-aware: matches the repaint() comparison baseline
		this.emitSceneChanged();
		// Place the final layout now — the pins the pipeline set hold lanes and groups; the force fills in the rest — and
		// glide every surviving node from where it is to where it lands over one eased tween. Positions exist before the
		// feed, so the tween starts immediately; the feed only gives the renderer the new set to display.
		this.profiler.compute(() => this.layoutForFeed().place(nodes, links));
		this.beginLayoutTween(from, nodes);
		if (this.nodeRebuildPending) this.forceNodeObjectRebuild(); // chip↔box on a view switch, or resized gantt bars
		this.renderer?.draw({ nodes, links });
	}

	/** Snapshot the placed targets, rewind every node to its start, and glide pins start→target. */
	private beginLayoutTween(from: Map<string, XYZ>, nodes: FGNode[]): void {
		// Placement runs before this, so every node has a position; one without is a defect, not a timing.
		const unplaced = nodes.find((n) => n.x === undefined);
		if (unplaced) throw new Error(`beginLayoutTween: node ${unplaced.id} has no position — place() must run first`);
		const to = new Map<string, XYZ>();
		for (const n of nodes) to.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 });
		// Anchor the last-selected node: translate the WHOLE solved layout so that node lands exactly where the user
		// left it — the layout's internal shape is unchanged (a rigid translation breaks no constraint), but the eye's
		// reference point holds still through the transition. z is never translated: it is the time axis (data).
		const anchorId = this.selectedSubject;
		const af = anchorId ? from.get(anchorId) : undefined;
		const at = anchorId ? to.get(anchorId) : undefined;
		if (af && at) {
			const dx = af.x - at.x;
			const dy = af.y - at.y;
			if (dx !== 0 || dy !== 0) {
				for (const p of to.values()) {
					p.x += dx;
					p.y += dy;
				}
			}
		}
		// Snap every node back to its start and pin it there, so the first painted frame is the BEFORE layout; the
		// tween then eases the pins to the targets. A node with no prior position (newly revealed) starts at its target.
		for (const n of nodes) {
			const start = from.get(n.id) ?? to.get(n.id);
			if (!start) continue;
			n.x = n.fx = start.x;
			n.y = n.fy = start.y;
			// z is the time axis (assigned from data in toGraphData), never a layout pin — don't tween it.
		}
		// Keep the engine ticking through the tween so it applies the pins and redraws links/sprites; pinned nodes
		// ignore the forces, so there is no churn — only our eased pin motion shows.
		this.engine.hold();
		this.tween = { start: performance.now(), from, to };
		if (this.hoverSubject || this.selectedSubject) this.requestFocusAtRest();
	}

	/** Advance the active ghost tween one frame: ease each node's pin from its start toward its target; release on completion. */
	private updateLayoutTween(): void {
		if (!this.tween) return;
		const e = easeInOutCubic(Math.min((performance.now() - this.tween.start) / TWEEN_MS, 1));
		for (const [id, f] of this.tween.from) {
			const t = this.tween.to.get(id);
			const n = this.nodeMap.get(id);
			if (!t || !n) continue;
			n.fx = f.x + (t.x - f.x) * e;
			n.fy = f.y + (t.y - f.y) * e;
			// z is the time axis — data-owned, never tweened
		}
		if (e < 1) return;
		// Done: settle each node at its target and release the pins so later data merges can nudge it again. A node the
		// reader dropped keeps its pin, as does the selected node: a placement by hand is a decision, which a layout
		// that frees the node again rejects, and the reader's reference point must not drift under them.
		for (const n of this.nodeMap.values()) {
			const t = this.tween.to.get(n.id);
			if (t) {
				n.x = t.x;
				n.y = t.y;
				// z stays at its current data value — toGraphData() owns it
			}
			if (n.id === this.selectedSubject || this.userPins.has(n.id)) {
				n.fx = n.x;
				n.fy = n.y;
				n.fz = n.z;
				continue;
			}
			n.fx = undefined;
			n.fy = undefined;
			n.fz = undefined;
		}
		this.engine.freeze(); // targets are an equilibrium; stop ticking so the graph rests
		this.tween = undefined;
		this.onLayoutSettled(); // queued view-type re-aim + (re)draw the gantt ruler, now the layout rests at its targets
		requestAnimationFrame(() => this.enclosureCtl.updateEnclosureGeometry());
	}

	/** What is focused: the open column's node stays focused while a column is open; hover takes over only when nothing is selected. */
	private get focusId(): string | null {
		return this.activeSubject ?? this.hoverSubject;
	}

	/** The selected subject IF it is in the graph. A selection made elsewhere (a reply column, a search) can name a node
	 *  this graph does not show — filtered out by type, dropped by prune, or never fetched. There is then no active node:
	 *  the graph carries on exactly as it is, rather than dimming every node against a focus that is not on screen or
	 *  following a node that cannot be seen. The selection itself is untouched, so hiding and re-showing the type brings
	 *  the active node back. */
	/** The colour a glow is built with, before the per-frame cycle reaches it: the middle of the active ramp. */
	private get activeHighlightColor(): string {
		return this.glowRamp[Math.floor(this.glowRamp.length / 2)];
	}

	private get activeSubject(): string | null {
		return this.selectedSubject && this.nodeMap.has(this.selectedSubject) ? this.selectedSubject : null;
	}

	/**
	 * Parent for the enclosure group: the forcegraph entity's own object3D. The node coordinates live in the
	 * `forcegraphGroup` child (added to this object3D at identity, so it shares this coordinate space), but THAT child
	 * is cleared and rebuilt on every graphData re-feed — attaching here keeps the enclosures stably parented and in
	 * the same space, instead of being briefly orphaned each repaint.
	 */
	private enclosureParent(): Obj3D | undefined {
		const entity = this.querySelector("[forcegraph]") as (Element & { object3D?: Obj3D }) | null;
		return entity?.object3D ?? undefined;
	}

	/** New edges announce themselves: a short staggered particle burst runs along each (capped — a bulk arrival is its own signal). */
	private animateFreshLinks(fresh: FGLink[]): void {
		if (!this.graph || fresh.length === 0) return;
		this.freshTimers = this.freshTimers.slice(-120);
		for (const l of fresh.slice(0, 20)) {
			for (const delay of [80, 480, 880]) {
				this.freshTimers.push(window.setTimeout(() => this.graph?.emitParticle(l), delay));
			}
		}
	}

	/** Drop the per-repaint model memo. Called at each repaint entry so seqNodes()/visibleModel() rebuild once per
	 *  repaint and the render-type layout caches (which key on the array reference) invalidate exactly then. */
	private invalidateModelCache(): void {
		this.modelCache = undefined;
		this.seqNodesCache = undefined;
	}

	private visibleModel(): GraphModel {
		if (this.modelCache) return this.modelCache;
		this.modelCache = visibleGraphModel({
			quads: this.model.visibleQuads,
			clusters: this.model.clusters,
			hiddenGraphs: this.model.hiddenGraphs,
			hiddenPredicates: this.model.hiddenPredicates,
			prune: this.config.prune,
			site: this.model.site,
			roleRels: roleEdgeLabels(),
		});
		return this.modelCache;
	}

	/** The visible model's nodes as sequence-mapper input (id, @type, derived role via properties, recorded time). The
	 *  sequence view derives its actors/messages from these — see mapGraphToSeq. */
	private seqNodes(): SeqNode[] {
		if (this.seqNodesCache) return this.seqNodesCache;
		const { times } = this.pipeline.extractTimes();
		this.seqNodesCache = this.visibleModel().nodes.map((n) => ({ id: n.id, type: n.type, displayLabel: n.displayLabel, properties: n.properties, __t: times.get(n.id)?.ms }));
		return this.seqNodesCache;
	}

	/** The display name for a sequence actor (a participant id). Mirrors the role-container labelling: the party's display
	 *  name prefixed by its role designation — named from the role rel by which nodes attribute to it, not the party's
	 *  vertex type (one Principal per DID); an id with no node falls back to the id. */
	/** The noun a party displays under: what the edge conferring the role declares its target is called, else the
	 *  party's own type. Declared vocabulary, read from the projection — a graph view names no roles of its own. */
	private roleNoun(roleRel: unknown, type: string | undefined): string | undefined {
		return roleNounFor(roleRel) ?? type;
	}

	private seqLabelFor(participantId: string): string {
		const partyNode = this.nodeMap.get(participantId);
		if (!partyNode) return participantId;
		const party = partyNode.name || participantId;
		const role = this.roleNoun(partyNode.properties?.[HYPERMEDIA_ROLE_REL_KEY], partyNode.type);
		return role && role !== party ? `${role} — ${party}` : party;
	}

	/** Ask the host to show the actor types, through the same reveal the schema scope uses. A no-op when they are all
	 *  shown already, so choosing the view repeatedly costs nothing. */
	private revealActorTypes(): void {
		const hidden = new Set(this.model.hiddenGraphs);
		const showing = [...this.model.knownClusters.keys()].filter((t) => !hidden.has(t));
		const types = actorTypesFor(showing).filter((t) => hidden.has(t));
		if (types.length === 0) return;
		this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.SCOPE_REVEALED, { detail: { types }, bubbles: true, composed: true }));
	}

	/** The actor bars the active view draws, each with what is attached to it in appearance order — the reading the
	 *  accessible document follows, so the document and the picture tell one story. Null off an actor-built view. The
	 *  membership is the layout's own (`barOf`), never re-derived from where things landed. */
	private actorBars(): Array<{ id: string; label: string; nodeIds: string[] }> | null {
		const layout = this.renderType.seqLayout?.();
		return layout && layout.actors.length > 0 ? actorBars(layout) : null;
	}

	/** The sequence-diagram ground truth for inspect()/tests, or null off-sequence: the participant actors, the
	 *  time-ordered cross-participant messages, and each placed node's lane (y) + time (z) on its lifeline. */
	private sequenceInspect(): { actors: TSeqModel["actors"]; messages: TSeqModel["messages"]; nodes: Array<{ id: string; y: number; z: number }> } | null {
		const rt = this.renderType;
		if (!rt.seqModel || !rt.seqLayout) return null;
		const model = rt.seqModel();
		const placement = rt.seqLayout().placement;
		return { actors: model.actors, messages: model.messages, nodes: [...placement.entries()].map(([id, p]) => ({ id, y: p.y, z: p.z })) };
	}

	/** The layered (td/lr) ground truth for inspect()/tests, or null off-td/lr: each node's pinned target (the layered
	 *  {x,y} the cohesion force holds it at) and its rendered position, plus which axis the DAG flows along — so a test
	 *  asserts the flow reads monotonically along that axis and the pins held (the render IS the layered structure). */
	private layeredInspect(): { direction: "td" | "lr"; flowAxis: "x" | "y"; nodes: Array<{ id: string; tx: number; ty: number; x: number; y: number; z: number }> } | null {
		const rt = this.renderType;
		const flow = rt.layeredFlow();
		if (!flow) return null;
		const nodes = [...this.nodeMap.values()].map((n) => {
			const lp = rt.lanePlacement(n.id);
			return { id: n.id, tx: lp?.x ?? 0, ty: lp?.y ?? 0, x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 };
		});
		return { ...flow, nodes };
	}

	private onNodeClick(n: FGNode, e?: MouseEvent): void {
		if (n.isCluster) {
			this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.CLUSTER_EXPAND, { detail: { type: n.type }, bubbles: true, composed: true }));
			return;
		}
		// In the ontology view a node IS a schema term, not an individual. A Class opens its own type column (its CLASS
		// view — description, schema graph, individuals), the same navigation a #Type reference / a graph Class-click uses,
		// so exploring the schema stays in the schema rather than dropping into a list of instances. A Property opens the
		// windowed instances of a type that declares it, sorted by it (no instances → no pane).
		if (n.type === ONTOLOGY_CLASS) {
			const detail = DesiredPaneSchema.parse({ paneType: "type", persistedAs: n.id });
			this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.NODE_OPEN_PANE, { detail, bubbles: true, composed: true }));
			return;
		}
		if (n.type === ONTOLOGY_PROPERTY) {
			this.openOntologyInstances(n);
			return;
		}
		// Opening a node hands the view to the user: from here the camera is theirs, exactly as after a zoom/pan/orbit.
		// The load-time auto-fit ends so that selecting/focusing a node — which re-pools link colours and can nudge the
		// layout — never re-frames under them ("the graph re-zoomed when I clicked a node"). A cluster-expand is excluded
		// above: it streams in new nodes, which SHOULD still auto-frame.
		this.camera.takeControl();
		// Pin the clicked node NOW, at its click-time position. Selection (and its pin) only comes back after the column's
		// async load — if anything reheats the engine in that gap, an unpinned node would drift and then be pinned at the
		// moved spot. Locking it here keeps the user's reference point exactly where they clicked. setSelectedSubject owns
		// the release (it unpins the previous selection); a fresh feed/relayout clears all pins as before.
		if (n.x !== undefined && n.y !== undefined) {
			n.fx = n.x;
			n.fy = n.y;
			n.fz = n.z;
		}
		// Follow moves at CLICK time: the selection only returns after the column's async load, and does not re-fire for
		// an already-selected subject — the camera must not wait on either. Choosing a node is the ONLY thing that moves
		// a following camera, so a pan or orbit afterwards stands until the next node is chosen.
		if (this.config.follow && n.id !== this.selectedSubject) this.followActive(n.id);
		// Neutral output: the host re-dispatches this to the app's column-open event.
		this.dispatchEvent(
			new CustomEvent(GRAPH_SCENE_EVENT.NODE_CLICK, {
				detail: { label: n.type, subject: n.id, addToSelection: Boolean(e?.ctrlKey || e?.shiftKey || e?.metaKey) },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Open the windowed instances column for a clicked ontology Property: the instances of a declaring type, sorted by it.
	 *  Routed through the app's PANE_OPEN bridge → the existing filter-prop pane (shu-filter-column → graphQuery). No
	 *  instances to show (an abstract super-property, or a property no type declares) → nothing opens. */
	private openOntologyInstances(n: FGNode): void {
		const target = this.propertyInstancesTarget(n.id);
		if (!target) return;
		// The polymorphic is a separate bundle, so this CustomEvent detail isn't type-checked against DesiredPane at compile
		// time the way an in-bundle PaneState.request() is. Parse it against the shared schema so a shape drift fails fast
		// here, at the source, rather than surfacing in the app's PANE_OPEN handler.
		const detail = DesiredPaneSchema.parse({ paneType: "filter-prop", ...target });
		this.dispatchEvent(new CustomEvent(GRAPH_SCENE_EVENT.NODE_OPEN_PANE, { detail, bubbles: true, composed: true }));
	}

	/** A Property's instances target: the first type whose data actually USES the rel — or any of its sub-properties, since
	 *  an abstract super-property (inRoleOf) is never used directly, but its concrete descendants (issuer, fromActor) are.
	 *  Opens that type's column keyed by the rel that's used. Undefined only when nothing in the data uses the rel or a
	 *  descendant — the actual uses, not the declared rdfs:domain, which a super-property or an undeclared rel wouldn't have. */
	private propertyInstancesTarget(rel: string): { persistedAs: string; predicate: string } | undefined {
		for (const q of this.model.quads) if (!isSchemaType(q.namedGraph) && isSubPropertyOf(q.predicate, rel)) return { persistedAs: q.namedGraph, predicate: q.predicate };
		return undefined;
	}

	/** Open a node's column programmatically — exactly the path a click takes (onNodeClick → COLUMN_OPEN). The
	 * production "reveal this node" entry point (also lets a test drive the open without a flaky WebGL pixel click,
	 * which synthetic pointer events can't reliably deliver to the lib's raycaster headless). Returns false if absent. */
	openNode(id: string): boolean {
		const n = this.nodeMap.get(id);
		if (!n) return false;
		this.onNodeClick(n);
		return true;
	}

	/** Which node a press at these client pixels would pick — pickNodeAt without any pointer side effects (no hover
	 * change). Lets a test prove the press-pick reads the chip's RESTING footprint, so a magnified focus chip never
	 * widens its own grab zone (the "focused node blocks the graph" guard at pickNodeAt). */
	pickAt(clientX: number, clientY: number): string | null {
		return this.pickNodeAt({ clientX, clientY } as MouseEvent)?.id ?? null;
	}

	/** The pixel a node is drawn at — its engine coordinates through the render camera, with the matrix forced current
	 *  (`pointerRay` forces the same, so aiming here and picking there agree between frames). Null when the scene has no
	 *  camera or canvas yet, or the id names no node. The graph's ONE projection: whatever aims at a node reads it here
	 *  rather than repeating the arithmetic, which is what lets a pick land on what a projection pointed at. */
	projectNodeToScreen(id: string): TClientPoint | null {
		const T = aframeThree();
		const cam = this.ctx.camera;
		const canvas = this.ctx.canvas;
		const n = this.nodeMap.get(id);
		if (!T || !cam || !canvas || !n) return null;
		(cam as { updateMatrixWorld?: (f?: boolean) => void }).updateMatrixWorld?.(true);
		const v = new T.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0) as unknown as { project(c: unknown): TNdc };
		return ndcToClient(v.project(cam), canvas.getBoundingClientRect());
	}

	/** Set or clear the hovered node programmatically — runs the real focus pass (the same effect a pointer hover
	 * has, minus the lib raycaster). For external highlight and for tests of the un-hover/move-off path. */
	setHoveredNode(id: string | null): void {
		const n = id ? (this.nodeMap.get(id) ?? null) : null;
		this.hoverSubject = n?.id ?? null;
		this.updateHoverInfo(n);
		this.requestFocusAtRest(); // a programmatic hover (external/test) with no pointer over the canvas must still wake the paused loop
		this.focusCtl.applyFocus();
	}

	/** The current column-view node (the host publishes it through the shared selection system). Sticky focus for
	 * adjacency dimming, and the node that wears the active frame. The selected node is also PINNED in place while
	 * selected — the user's reference point holds still through stream settles and reheats; everything else lays out
	 * around it. Deselection releases the pin. */
	setSelectedSubject(subject: string | null): void {
		this.requestFocusAtRest(); // paused/idle case: the render loop re-applies at rest; the direct applyFocus below covers the frozen case
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
		if (this.config.follow && subject && subject !== previous) this.followActive(subject); // a NEW active node centres; re-asserting the same one leaves the camera where the reader put it
		this.focusCtl.applyFocus();
	}

	/** A type hovered in the host's filter legend: dim every other type. Null clears the preview. */
	setPreviewType(type: string | null): void {
		this.previewType = type;
		this.requestFocusAtRest();
		this.focusCtl.applyFocus();
	}

	/** A mode/dimensionality change (flatten/dag/group): coalesce into one debounced ghost tween (see repaintLayout). */
	private relayout(): void {
		if (!this.graph) return;
		this.scheduleLayout();
	}

	/* Visual-graph navigation, exposed imperatively so a control step, a keyboard shortcut, or a button all drive ONE
	 * path. These are the ONLY sanctioned camera changes — the explicit, user-initiated re-framing. Nothing else (a
	 * node click, focus, data feed, or a resize) may re-decide the zoom: the graph never auto-determines its framing. */

	/** The placed-gantt extent the camera frames (centre + half-spans of the bars) — computed here, in the gantt
	 *  layout's owner, and handed to the camera controller so it never reaches into render-type state. The time span
	 *  (z) becomes screen-horizontal and the lane stack (y) screen-vertical. Null when no bars are placed. */
	private ganttExtent(): GanttExtent | null {
		if (this.ganttTargets.size === 0) return null;
		let minY = Infinity,
			maxY = -Infinity,
			minZ = Infinity,
			maxZ = -Infinity; // one pass over the placed bars
		for (const { y, z, zLen } of this.ganttTargets.values()) {
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (z - zLen / 2 < minZ) minZ = z - zLen / 2;
			if (z + zLen / 2 > maxZ) maxZ = z + zLen / 2;
		}
		return {
			cy: (minY + maxY) / 2,
			cz: (minZ + maxZ) / 2,
			halfH: Math.max((maxY - minY) / 2 + GANTT_ROW_H, 1), // lanes → screen-vertical
			halfW: Math.max((maxZ - minZ) / 2, 1), // time span → screen-horizontal
		};
	}

	/** The participant-lane (y) × time (z) extent the camera frames for the sequence view, mirroring ganttExtent and
	 *  sourced from the active RenderType's seqLayout; null when the active view has no sequence layout. */
	private sequenceExtent(): GanttExtent | null {
		const layout = this.renderType.seqLayout?.();
		if (!layout || layout.placement.size === 0) return null;
		let minY = Infinity,
			maxY = -Infinity,
			minZ = Infinity,
			maxZ = -Infinity;
		for (const { y, z } of layout.placement.values()) {
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		// A placement is a node's ANCHOR; its chip reads outward from there, so the extent carries a lane's worth of
		// room on the lane axis — without it the outermost lifeline's label sits half outside the frame.
		return {
			cy: (minY + maxY) / 2,
			cz: (minZ + maxZ) / 2,
			halfH: Math.max((maxY - minY) / 2 + SEQ_LANE_SPACING, 1), // participant lanes → screen-vertical
			halfW: Math.max((maxZ - minZ) / 2 + GANTT_ROW_H, 1), // time → screen-horizontal
		};
	}

	/** Re-frame so the whole graph fits the viewport — the "fit" button/step, view-relative: the render type declares
	 *  what fit means for its view (a lane view re-establishes its canonical frame; the force family keeps the orbit
	 *  orientation and re-sizes). While the layout is still moving the move is queued for the settle; framing now would
	 *  frame where the nodes are, not where they stop. Delegates to the camera controller, the sole owner of framing. */
	fitGraph(): void {
		const move = this.renderType.fitMove();
		if (this.engine.mode === "frozen") this.camera.frame(move);
		else this.camera.queueFrame(move);
	}

	/** Frame a node and its 1-hop neighbours, so a doc/tour step can jump straight to a node's local context rather than
	 *  the whole graph. Gathers the node plus every node one link away and fits the camera to just that subset; a no-op
	 *  when the node isn't in the graph. */
	fitGraphAround(nodeId: string): void {
		if (!this.nodeMap.has(nodeId)) return;
		const positions: FGNode[] = [];
		for (const id of neighboursOf(nodeId, this.linkMap.values())) {
			const n = this.nodeMap.get(id);
			if (n) positions.push(n);
		}
		this.camera.fitPositions(positions);
	}

	/** Follow the active node: centre it, holding the reader's zoom level. Not a fit around its neighbourhood — that
	 *  sizes the distance to each node's own surroundings, so the label scale would change from node to node; the zoom
	 *  belongs to the reader, and following only moves what the camera looks at. With the guide open over the canvas,
	 *  "centre" is the clear strip beside it — centring under the guide showed the reader nothing. */
	private followActive(nodeId: string): void {
		const n = this.nodeMap.get(nodeId);
		if (n) this.camera.centerOn(n, this.guideClearOffset() ?? undefined);
	}

	/** The open guide's occlusion of the canvas, as the aim offset a framing applies — null when the guide is closed,
	 *  elsewhere, or leaves the centre clear. */
	private guideClearOffset(): { dxPx: number; dyPx: number } | null {
		const region = this.querySelector<HTMLElement>("#polymorphic-a11y");
		const canvas = this.ctx.canvas;
		if (!region || !canvas || !(region.hasAttribute("data-shown") || region.matches(":focus-within"))) return null;
		return clearStripOffset(canvas.getBoundingClientRect(), region.getBoundingClientRect());
	}

	/** The one "layout has come to rest" hook — both settle paths (a no-tween engine stop and a tween's completion) call
	 *  it, so they can't drift: apply any queued framing move, then (re)draw the active lane view's axis overlay.
	 *  Following does NOT re-centre here: a settle is not a choice the reader made, and re-centring on one would undo
	 *  a pan or an orbit the moment the layout came to rest. */
	private onLayoutSettled(): void {
		this.camera.applyPendingFrame();
		this.updateLaneAxis();
	}

	/** Draw the calendar ruler for a view that reads along a calendar, and take it off screen for one that does not, so a
	 *  view switch cannot leave the previous view's ruler behind. A sequence's lifelines are the actor chips themselves,
	 *  so it needs no overlay of its own. */
	private updateLaneAxis(): void {
		if (this.renderType.drawsCalendarAxis) this.updateGanttAxis();
		else this.clearGanttAxis();
	}

	/** Standard overlay-label styling (the gantt ruler ticks + the drag-ghost date): always-on-top, never depth-hidden,
	 *  not pickable. Keeps the few SpriteText overlays consistent from one place. */
	private configureOverlayLabel(label: TSprite): void {
		label.renderOrder = ENCLOSURE_LABEL_RENDER_ORDER;
		label.material.depthTest = false;
		label.material.depthWrite = false;
		if (label.raycast) label.raycast = () => undefined;
	}

	/** Tear down a parented overlay group: dispose each child's material + texture and detach from its parent. Owned
	 *  geometry is disposed only when `disposeGeometry` is set — the ghost reuses the shared unitEdges and must NOT. */
	private disposeGroup(group: Obj3D, disposeGeometry: boolean): void {
		for (const child of [...(group as unknown as { children: Obj3D[] }).children]) {
			const c = child as unknown as { geometry?: Disposable; material?: Disposable; dispose?: () => void };
			if (disposeGeometry) c.geometry?.dispose?.();
			c.material?.dispose?.();
			c.dispose?.(); // SpriteText owns a texture
		}
		(group as unknown as { parent?: { remove(o: Obj3D): void } }).parent?.remove(group);
	}

	/** The gantt calendar ruler: a world-space baseline along z (the time axis) with calendar tick marks + date labels,
	 *  just below the lowest lane, so a dragged bar has a real date reference. Lives in the node coordinate space (the
	 *  forcegraph object), rebuilt whenever the scale/data change; removed off-gantt. */
	private updateGanttAxis(): void {
		this.clearGanttAxis(); // tick set + positions change with the data/scale → rebuild rather than diff
		const T = aframeThree();
		const ad = this.ganttAdornment;
		if (!T || !ad) return; // the layout pass produces the ruler only for a non-empty calendar
		const parent = this.enclosureParent();
		if (!parent) return;
		const { baseY, zMin, zMax, ticks } = ad;
		const tickH = GANTT_ROW_H * 0.5;
		const group = new T.Group();
		(group as Obj3D & { name: string }).name = "shu-gantt-axis";
		// Baseline (axis min → max along z) + one upward vertical per tick, as a single line-segments mesh.
		const pts = [0, baseY, zMin, 0, baseY, zMax];
		for (const tk of ticks) pts.push(0, baseY, tk.z, 0, baseY + tickH, tk.z);
		const geo = new T.BufferGeometry();
		geo.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
		const mat = new T.LineBasicMaterial({ color: this.compassAccentColor, transparent: true, opacity: 0.7, depthWrite: false });
		const lines = new T.LineSegments(geo, mat);
		lines.raycast = () => undefined;
		lines.renderOrder = ENCLOSURE_RENDER_ORDER;
		group.add(lines);
		for (const tk of ticks) {
			const s = new SpriteText(tk.label, ENCLOSURE_LABEL_HEIGHT, this.compassFgColor) as unknown as TSprite;
			s.position.set(0, baseY - tickH, tk.z);
			this.configureOverlayLabel(s);
			group.add(s as unknown as Obj3D);
		}
		parent.add(group);
		this.ganttAxisGroup = group;
	}

	private clearGanttAxis(): void {
		if (this.ganttAxisGroup) this.disposeGroup(this.ganttAxisGroup, true); // owns its BufferGeometry → dispose it
		this.ganttAxisGroup = undefined;
	}

	/** The drag affordance for a gantt bar: a wireframe outline around the bar at its live position plus the new start
	 *  date-time (formatDate, which renders future dates fine), updated every move. Reuses the shared unit-box edges +
	 *  the SpriteText label pattern; parented into node-coordinate space like the enclosures. */
	private updateGanttGhost(node: FGNode): void {
		const T = aframeThree();
		const target = this.ganttTargets.get(node.id);
		const scale = this.ganttScale;
		if (!T || !target || !scale || node.z === undefined) return;
		this.enclosureCtl.ensureUnitBox(T);
		const parent = this.enclosureParent();
		if (!parent || !this.enclosureCtl.unitEdges) return;
		if (!this.ganttGhost) {
			const edgeMat = new T.LineBasicMaterial({ color: this.compassAccentColor, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
			const edges = new T.LineSegments(this.enclosureCtl.unitEdges, edgeMat);
			edges.raycast = () => undefined;
			edges.renderOrder = ENCLOSURE_LABEL_RENDER_ORDER;
			const label = new SpriteText("", ENCLOSURE_LABEL_HEIGHT, this.compassFgColor) as unknown as TSprite;
			this.configureOverlayLabel(label);
			const group = new T.Group();
			group.add(edges);
			group.add(label as unknown as Obj3D);
			parent.add(group);
			this.ganttGhost = { group, label };
		}
		const g = this.ganttGhost;
		const x = node.x ?? 0;
		const y = node.y ?? 0;
		const zLen = Math.max(target.zLen, GANTT_MIN_BAR_W);
		const edges = (g.group as unknown as { children: Obj3D[] }).children[0];
		edges.scale.set(GANTT_BAR_D + GANTT_GHOST_PAD, GANTT_BAR_H + GANTT_GHOST_PAD, zLen + GANTT_GHOST_PAD);
		edges.position.set(x, y, node.z);
		(g.label as unknown as { text: string }).text = formatDate(ganttBarTimes(node.z, target.zLen, scale).startedAtTime);
		(g.label as unknown as Obj3D).position.set(x, y + GANTT_BAR_H, node.z);
	}

	private clearGanttGhost(): void {
		if (this.ganttGhost) this.disposeGroup(this.ganttGhost.group, false); // reuses the shared unitEdges → keep geometry
		this.ganttGhost = undefined;
	}

	/* Visual-graph navigation, the ONLY sanctioned camera changes — the explicit, user-initiated re-framing. Public
	 * entries (a control step, key, or button all drive ONE path) that delegate to the camera controller, which owns
	 * the math and latches the camera away from the load-time auto-fit. */
	zoomBy(amount: number, unit: "pixels" | "percent", dir: "in" | "out"): void {
		this.camera.zoomBy(amount, unit, dir);
	}

	panBy(amount: number, unit: "pixels" | "percent", dir: "left" | "right" | "up" | "down"): void {
		this.camera.panBy(amount, unit, dir);
	}

	orbitBy(degrees: number, dir: "left" | "right" | "up" | "down"): void {
		this.camera.orbitBy(degrees, dir);
	}

	/** Rotate to a head-on aim: `xy` faces the layout plane (the front default), `z` faces the depth axis (time reads left→right). */
	rotateTo(aim: "xy" | "z"): void {
		this.camera.frame(aim === "xy" ? FRAME.front : FRAME.side);
	}

	/** The visible graph as one JSON-LD node — the single representation the copy-graph button and `summarizeForKihan` both use, so what a person copies and what the model reads are the same data. The members are the system's own statement projection (the shape getClusteredQuads serves and chat batching consumes), not an invented nodes/edges dialect. */
	graphJsonLd(): Record<string, unknown> {
		const { nodes, edges } = this.visibleModel();
		const hidden = new Set(this.model.hiddenGraphs);
		const quads = this.model.visibleQuads.filter((q) => !hidden.has(q.namedGraph));
		// `nodeCount`/`edgeCount` describe the graph the quads project (the render's own node/edge set), so a reader — a
		// Kihan, the clipboard, or a driver asserting expected values — has the counts without re-deriving them from the
		// statements. `totalItems` stays the collection's own member count (the quads).
		return {
			"@id": "view:graph",
			"@type": "as:Collection",
			name: "visible graph",
			nodeCount: nodes.length,
			edgeCount: edges.length,
			totalItems: quads.length,
			quads: quads.map(({ subject, predicate, object, namedGraph }) => ({ subject, predicate, object, namedGraph })),
		};
	}

	/** The host's copy-graph button copies the same JSON-LD the Kihan reads, pretty-printed. */
	graphCopyText(): string {
		return JSON.stringify(this.graphJsonLd(), null, 2);
	}

	/** The current graph as a self-contained SVG still: the SAME placed nodes and links the WebGL renderer displays,
	 *  drawn by another renderer — for a report, a print, a saved image. Positions are the scene's own (layoutForFeed),
	 *  so nothing is computed twice and a still always matches what is on screen. */
	still(): string {
		const svg = new SvgRenderer({ timeIsHorizontal: () => this.renderType.timeIsHorizontal });
		svg.draw({ nodes: [...this.nodeMap.values()], links: this.currentLinks });
		return svg.markup;
	}

	summarizeForKihan(): TLinkedData | null {
		return this.graphJsonLd();
	}
}

if (!customElements.get("shu-graph-scene")) {
	customElements.define("shu-graph-scene", ShuGraphScene);
}
