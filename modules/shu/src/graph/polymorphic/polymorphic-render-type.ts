// The fisheye's render-type subsystem: the view's `viewType` union promoted into a pluggable RenderType — one object per
// layout (force/td/lr, gantt, sequence) that owns BOTH sides of every layout-mode dispatch, so the force config and the
// node placement can never disagree about where a node goes. The component holds a Map<id, RenderType> + the active one;
// switching type swaps the active object, re-layouts, re-frames.
//
// THE CRUX (3D views): a node's force lane target (the groupX/groupY pull) and its data-assigned z BOTH read ONE method —
// lanePlacement(id) — so the two cannot diverge mid-settle (the "node teleports while the layout is still settling"
// failure). A gantt RenderType returns {y, z} from its placement cache; the force-family RenderTypes return undefined (no
// lane: the layout owns x/y, z is the recorded-time depth). render-type-consistency.test.ts pins this.
//
// THE SEQUENCE: a sequence diagram is gantt rotated 90° — participants are lanes, time is the SAME z axis gantt uses, and
// each participant is a lifeline (a pillar along z). So SequenceRenderType is a 3D peer of gantt: it returns its {y,z}
// lanePlacement from a cached pure layout (mapGraphToSeqLayout) and suppresses the generic grouping (its lifelines ARE the
// grouping). It also exposes seqModel()/seqLayout() — the actors + messages and the lane placement — for inspect()/tests.
//
// Wired the same way as FisheyeCamera / DataPipeline: each RenderType is constructed with accessor deps read at CALL
// time, so the component's per-repaint layout-target caches (ganttTargets) stay current behind a getter.

import { nothing, type TemplateResult } from "lit";
import { mapGraphToSeq, mapGraphToSeqLayout, type TSeqModel, type SeqNode, type SeqEdge, type SeqLayout } from "./sequence-model.js";
import { layeredPositions, type LayeredDirection, LAYERED_MIN_FLOW_SPAN } from "./layered-solver.js";
import { truncateLabel } from "./layout-forces.js";
import type { GanttTarget } from "./polymorphic-data-pipeline.js";
import { VIEW, VIEW_TYPES, type ViewType, REFRAME, type ReframeMode, FRAME, type FrameMove, asViewType } from "./polymorphic-views.js";

/** Sentinel a render type's `controls()` returns when it adds nothing to the shared control bar (lit's no-render value). */
export type ControlsFragment = TemplateResult | typeof nothing;

/** Context a render type's `controls()` reads to build its OWN control fragment. No view today adds controls of its own
 *  (a sequence is actors + messages — nothing to toggle), so this is empty; kept as the extension point. */
export type RenderTypeControlsCtx = Record<string, never>;

/** A node's pinned target: the {x,y} the groupX/groupY force pulls it to, plus the z it is placed on when the view sets
 *  one (the time axis). ONE source, so the force config and the data-assigned z can't drift. A gantt/sequence lane sets
 *  {y,z} (x falls to 0); the td/lr layered flow sets {x,y} (z stays the recorded-time depth). undefined = the free force. */
export type LanePlacement = { x?: number; y: number; z?: number };

/** The calendar context a node's @type presenter needs to paint a duration mark (a gantt bar's span). undefined = the
 *  node has no time mark in this view (a point-in-time chip). */
export type MarkTime = { start: number; end: number; zExtent: number };

/** Live caches the component exposes; every getter is read at CALL time so a per-repaint-refreshed map is current. */
export type RenderTypeDeps = {
	ganttTarget: (id: string) => GanttTarget | undefined;
};

/** The data the SequenceRenderType reads to derive its actors/messages + lane layout: the visible graph (nodes + edges,
 *  with each node's folded role + recorded time), the human form of an edge predicate, and the display label for a
 *  participant id. Read at CALL time so the layout reflects the current model. */
export type SeqRenderDeps = {
	seqNodes: () => ReadonlyArray<SeqNode>;
	seqEdges: () => ReadonlyArray<SeqEdge>;
	labelOf: (participantId: string) => string;
};

/** The layout options a view overrides while active. */
export type TViewForces = { grouped?: boolean; flatten?: boolean; labelAsZ?: boolean };

/** What a LANE view (gantt, sequence) settles: its bars are its grouping, its axis is time — so grouping into container
 *  cells, flattening that axis, and labelling a chip with its depth all belong to the free views, not here. */
const LANE_FORCES: TViewForces = { grouped: false, flatten: false, labelAsZ: false };

/** One layout's behaviour, capturing both sides of every dispatch the view makes on its old `viewType` union. */
export interface RenderType {
	readonly viewType: ViewType;
	/** The camera aim queued on entering this view-type. */
	reframeMode(): ReframeMode;
	/** The framing the fit button re-establishes while this view is active — view-relative fit. */
	fitMove(): FrameMove;
	/** THE shared source: the force lane target AND the node-z come from this one call, so they can't diverge. */
	lanePlacement(id: string): LanePlacement | undefined;
	/** The duration-mark calendar context for a node's @type presenter (gantt bars); undefined for a point-in-time chip. */
	markTime(id: string): MarkTime | undefined;
	/** Does a node drag reschedule along the time z (gantt), or move the node in the x/y plane (everything else)? */
	readonly dragReschedules: boolean;
	/** Time reads left to right in this view — z is the calendar axis and the camera faces the lane plane, so any
	 *  other medium showing this view (the SVG still) faces it too. */
	readonly timeIsHorizontal: boolean;
	/** Gantt folds the time z into the model hash (a reschedule moves bars without touching nodes/links). */
	readonly hashFoldsZ: boolean;
	/** This view is built on ACTORS: it draws a bar per actor, so the actor types must be shown for it to read at all. */
	readonly needsActors: boolean;
	/** The layout options this view OVERRIDES while it is active. A lane view draws on a time axis and its bars are its
	 *  grouping, so a remembered "grouped" or "flatten" choice does not apply — it would place nodes in container cells
	 *  or collapse the very axis the view reads along. Declared here so choosing the view settles the conflict once,
	 *  rather than each consumer remembering which options a view can't honour. */
	readonly forces: TViewForces;
	/** A LANE view (gantt) IS its own grouping — the lanes are the axis — so the generic group/group-by controls and the
	 *  role/type enclosure boxes don't apply: true suppresses them while this view is active. The 2D sequence likewise
	 *  suppresses them (it has no 3D enclosures at all). */
	readonly suppressesGrouping: boolean;
	/** This view's OWN control fragment for the shared control bar, or `nothing` when the view adds no controls of its own. */
	controls(ctx: RenderTypeControlsCtx): ControlsFragment;
	/** The actors + messages model for inspect()/tests (the sequence's protocol read). Present only on the sequence view. */
	seqModel?(): TSeqModel;
	/** The 3D sequence layout (participant lanes + per-node placement) — the pillars, framing extent, and inspect read it.
	 *  Present only on the sequence view. */
	seqLayout?(): SeqLayout;
}

abstract class BaseRenderType implements RenderType {
	constructor(protected deps: RenderTypeDeps) {}
	abstract readonly viewType: ViewType;
	reframeMode(): ReframeMode {
		return REFRAME.front;
	}
	/** A lane view has ONE canonical frame, so its aim IS its fit; the force family has no canonical aim, so fit keeps
	 *  the user's orbit and re-frames the bounds. Derived from `reframeMode` — the rule is stated once, for every view. */
	fitMove(): FrameMove {
		const aim = this.reframeMode();
		return aim === REFRAME.front ? FRAME.fit : aim;
	}
	lanePlacement(_id: string): LanePlacement | undefined {
		return undefined;
	}
	markTime(_id: string): MarkTime | undefined {
		return undefined;
	}
	readonly forces: TViewForces = {};
	readonly needsActors: boolean = false;
	readonly dragReschedules: boolean = false;
	readonly timeIsHorizontal: boolean = false;
	readonly hashFoldsZ: boolean = false;
	/** Grouping controls are offered unless the view forces grouping off — the same declaration, read for the controls. */
	get suppressesGrouping(): boolean {
		return this.forces.grouped === false;
	}
	controls(_ctx: RenderTypeControlsCtx): ControlsFragment {
		return nothing;
	}
}

/** force: the free d3 force layout owns x/y; z is the recorded-time depth (no lane). */
export class ForceRenderType extends BaseRenderType {
	constructor(
		readonly viewType: "force",
		deps: RenderTypeDeps,
	) {
		super(deps);
	}
}

/** td / lr: a layered (Sugiyama) structural flow. The pure layeredPositions over the visible model gives each node a
 *  pinned {x,y} the cohesion force holds it at — recomputed only when the visible-node array reference changes (a repaint
 *  hands a fresh array), the same caching the sequence uses — so per-node lanePlacement reads are cheap. z stays the
 *  recorded-time depth, so the flow reads structurally in x/y while time reads in depth (the option can still flatten it). */
export class LayeredRenderType extends BaseRenderType {
	constructor(
		readonly viewType: "td" | "lr",
		deps: RenderTypeDeps,
		private modelDeps: SeqRenderDeps,
	) {
		super(deps);
	}
	// Grouping by type/role is ORTHOGONAL to the DAG ranks, so the layered view does NOT suppress it (unlike the lane
	// views, whose lanes ARE their grouping): a person can still gather kinds into boxes over the hierarchy.
	private cacheRef?: ReadonlyArray<SeqNode>;
	private cached?: Map<string, { x: number; y: number }>;
	private positions(): Map<string, { x: number; y: number }> {
		const nodes = this.modelDeps.seqNodes();
		if (this.cacheRef !== nodes || !this.cached) {
			this.cacheRef = nodes;
			const direction: LayeredDirection = this.viewType === VIEW.td ? "TB" : "LR";
			const named = nodes.map((n) => ({ id: n.id, label: truncateLabel(n.displayLabel ?? n.id) })); // bound the label so nodeWidth can't fan a layer out
			const raw = layeredPositions(named, this.modelDeps.seqEdges(), direction);
			// Stretch the rank axis UP TO LAYERED_MIN_FLOW_SPAN so the hierarchy clears the time-depth — but only upward: a
			// DAG already taller than that keeps its natural spacing, and a wide left-right flow isn't blown up.
			const flowOf = (p: { x: number; y: number }): number => (direction === "TB" ? p.y : p.x);
			const flows = [...raw.values()].map(flowOf);
			const extent = flows.length ? Math.max(...flows) - Math.min(...flows) : 0;
			const scale = extent > 0 ? Math.max(1, LAYERED_MIN_FLOW_SPAN / extent) : 1;
			const scaled = new Map<string, { x: number; y: number }>();
			for (const [id, p] of raw) scaled.set(id, direction === "TB" ? { x: p.x, y: p.y * scale } : { x: p.x * scale, y: p.y });
			this.cached = scaled;
		}
		return this.cached;
	}
	override lanePlacement(id: string): LanePlacement | undefined {
		const p = this.positions().get(id);
		return p ? { x: p.x, y: p.y } : undefined;
	}
}

/** gantt: tasks placed on the calendar — y = lane row, z = bar centre on the linear time axis; a drag reschedules. */
export class GanttRenderType extends BaseRenderType {
	readonly viewType = VIEW.gantt;
	override reframeMode(): ReframeMode {
		return REFRAME.gantt;
	}
	override lanePlacement(id: string): LanePlacement | undefined {
		const t = this.deps.ganttTarget(id);
		return t ? { y: t.y, z: t.z } : undefined;
	}
	override markTime(id: string): MarkTime | undefined {
		const t = this.deps.ganttTarget(id);
		return t ? { start: t.start, end: t.end, zExtent: t.zLen } : undefined;
	}
	override readonly dragReschedules = true;
	override readonly timeIsHorizontal: boolean = true;
	override readonly hashFoldsZ = true;
	override readonly forces: TViewForces = LANE_FORCES;
}

/** sequence: a 3D sequence diagram aligned with gantt — participants are lanes on y, time is the SHARED z axis (the same
 *  z=time gantt uses), each participant a vertical lifeline (pillar along z) with its events on it at their time and
 *  cross-participant edges as the messages. Reuses gantt's {y,z} placement (so the force lane-y and the node-z agree)
 *  and the lane-plane framing, rolled 90° so participants read across the top and time reads downward. The pure
 *  mapGraphToSeqLayout is cached per visible-model reference; lanePlacement feeds the same force + node-z path as gantt. */
export class SequenceRenderType extends BaseRenderType {
	readonly viewType = VIEW.sequence;
	override readonly needsActors = true;
	constructor(
		deps: RenderTypeDeps,
		private seqDeps: SeqRenderDeps,
	) {
		super(deps);
	}
	override readonly forces: TViewForces = LANE_FORCES;
	override readonly timeIsHorizontal: boolean = true;
	override reframeMode(): ReframeMode {
		return REFRAME.sequence;
	}
	private cacheRef?: ReadonlyArray<SeqNode>;
	private cached?: SeqLayout;
	/** The 3D layout (participants→lanes, events→time on z), recomputed only when the visible-node array reference changes
	 *  (a repaint hands a fresh array), so per-node lanePlacement reads are cheap. */
	seqLayout(): SeqLayout {
		const nodes = this.seqDeps.seqNodes();
		if (this.cacheRef !== nodes || !this.cached) {
			this.cacheRef = nodes;
			this.cached = mapGraphToSeqLayout(nodes, this.seqDeps.seqEdges(), { labelOf: this.seqDeps.labelOf });
		}
		return this.cached;
	}
	override lanePlacement(id: string): LanePlacement | undefined {
		return this.seqLayout().placement.get(id);
	}
	/** A participant's lifeline IS a gantt duration bar: its active-window span drives the SAME box mark gantt uses (zExtent
	 *  = window length), so markFor emits a box for a participant and a point-in-time chip for an artifact — no bespoke shape. */
	override markTime(id: string): MarkTime | undefined {
		const s = this.seqLayout().spans.get(id);
		return s ? { start: s.z0, end: s.z1, zExtent: Math.abs(s.z1 - s.z0) } : undefined;
	}
	/** The actors + messages model for inspect()/tests (the protocol read of the same layout). */
	seqModel(): TSeqModel {
		const { seqNodes, seqEdges, labelOf } = this.seqDeps;
		return mapGraphToSeq(seqNodes(), seqEdges(), { labelOf });
	}
}

/** Build the registry: one RenderType per view-type, all sharing the one injected deps so the active one always reads
 *  the component's current layout-target caches. The component holds this Map and the active RenderType. */
export const buildRenderTypeRegistry = (deps: RenderTypeDeps, seqDeps: SeqRenderDeps): Map<ViewType, RenderType> =>
	new Map<ViewType, RenderType>([
		[VIEW.force, new ForceRenderType(VIEW.force, deps)],
		[VIEW.td, new LayeredRenderType(VIEW.td, deps, seqDeps)],
		[VIEW.lr, new LayeredRenderType(VIEW.lr, deps, seqDeps)],
		[VIEW.gantt, new GanttRenderType(deps)],
		[VIEW.sequence, new SequenceRenderType(deps, seqDeps)],
	]);
