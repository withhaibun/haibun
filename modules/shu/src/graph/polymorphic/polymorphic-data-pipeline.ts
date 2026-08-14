// The polymorphic's data-flow subsystem: it turns the (time-filtered, type-gated) quad model into the {nodes, links}
// the force engine renders, and owns the layout-stable bookkeeping that flow needs — the per-id FGNode map (reused
// across repaints so a node's three.js sprite/scale refs survive), the FGLink map (reused so __lineObj/__labelSprite
// refs are never orphaned), the parked positions of nodes that left the visible set, and the one-per-lifetime sqrt-age
// depth scale (re-derived only at the coarse-tick moments, never on a plain streaming merge). The component calls
// toGraphData from repaint/repaintLayout and delegates capturePositions/hashCurrentModel/extractTimes to it.
//
// Wired the same way as PolymorphicCamera: constructor-injected accessor deps, read at CALL time, so a late-bound scene
// ref or a per-repaint-refreshed component field is always current. The component still drives the layout-target
// caches (gantt/swimlane), the group anchors and the magnify pop; the pipeline reads/writes them through these deps
// rather than owning render-type state the rest of the component also reads.

import { groupKeyOf, type GroupKeyMode, type GroupAnchor, type XYZ } from "../grouping.js";
import { timeZScale, timeZ, spanZScale, spanZ, subjectValidTimes, type TimeZScale, type TSubjectTime, type TSubjectTimes } from "../time-axis.js";
import { quadsToGanttModel } from "../gantt-model.js";
import { browserRelOf } from "../paint-select.js";
import { isSchemaType } from "../ontology-projection.js";
import { computeLayout, type Adornment } from "../graph-layout.js";
import { hashModel, linkKey } from "./model-hash.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { GraphModel } from "../../graph-model.js";
import { type FGNode, type FGLink, linkEndId } from "./polymorphic-graph-types.js";

const NEWCOMER_SEED_SPREAD = 40; // a streamed node spawns within this radius of its neighbour/type so it eases in instead of flying from the origin
const TIME_DEPTH_MAX = 700; // depth range in world units — full span of the visible dates fills this. The auto-fit frames the 3D bounds, so more depth mostly backs the camera off (it reads as separation only up to ~the x/y layout spread) and pushes the deepest nodes small enough that the focus magnifier pops them harder — a moderate range. The sqrt scale (time-axis) does the real work of making long gaps read deeper than short ones.

import type { ViewType } from "./polymorphic-views.js";
import { VIEW } from "./polymorphic-views.js";
import { LAYERED_Z_FACTOR } from "./layered-solver.js";
import { truncateLabel } from "./layout-forces.js";
import { gridSlot } from "./group-grid.js";
export type GanttTarget = { y: number; z: number; zLen: number; start: number; end: number };
export type GanttScale = { min: number; span: number };

/** Accessors the component supplies; every getter is read at CALL time (per-repaint component fields stay current). */
export type DataPipelineDeps = {
	viewType: () => ViewType;
	flatten: () => boolean;
	grouped: () => boolean;
	groupBy: () => GroupKeyMode;
	quads: () => TQuad[]; // cgState.quads
	visibleQuads: () => TQuad[];
	hiddenGraphs: () => string[]; // cgState.hiddenGraphs
	visibleModel: () => GraphModel;
	lastModelHash: () => number | undefined; // undefined = first feed / post-reset (everything is "new", no arrival pops)
	timeCursor: () => number | null; // the resolved cursor (a pinned view's frozen instant, else the global cursor); null = live
	zBasis: () => "valid" | "indexed" | "connections"; // what places depth: the object's valid time (its declared field), its indexed time (generatedAtTime), or its number of connections
	validTimeFieldFor: (type: string) => string; // the catalog's validTimeField per label (rels-cache)
	groupAnchors: () => Map<string, GroupAnchor>;
	groupSizes: () => Map<string, { w: number; h: number }>;
	setGanttTargets: (targets: Map<string, GanttTarget>) => void;
	setGanttScale: (scale: GanttScale | undefined) => void;
	setGanttAdornment: (adornment: Adornment) => void;
	setGanttShapeSig: (sig: string) => void;
	laneZ: (id: string) => number | undefined; // the node's z on a lane view's time axis — the SAME RenderType.lanePlacement source the force lane-y reads, so force target and node-z can't diverge mid-settle
	lanePinXY: (id: string) => { x: number; y: number } | undefined; // the layered (td/lr) view's EXACT Sugiyama {x,y}, seeded into the data on a re-place so the deterministic layout isn't force-approximated (and compressed); undefined off td/lr
	userPinXY: (id: string) => { x: number; y: number } | undefined; // where the user dropped this node (persisted across reloads). It outranks every deterministic pin: a placement by hand is a decision, and a layout that puts the node back rejects it
	startNewcomerPop: (n: FGNode) => void; // register the cartoon grow-in for a streamed node (the magnify subsystem owns the easing)
};

export class DataPipeline {
	constructor(private deps: DataPipelineDeps) {}

	// Reused across repaints so a node's three.js sprite/scale refs survive and link __lineObj/__labelSprite refs are
	// never orphaned. The component reads these through delegating getters; the pipeline is their sole writer.
	nodeMap = new Map<string, FGNode>();
	linkMap = new Map<string, FGLink>();
	/** Positions of nodes that left the visible set (filtered out by time cursor or group change). Restored when the
	 *  node re-enters so it reappears where it was, not at the group anchor. */
	parkedPositions = new Map<string, { x: number; y: number }>();
	// The sqrt-age depth scale, cached so a streaming merge does NOT re-derive it: re-deriving from the new min/max ages
	// would shift every settled node's z (its camera distance, hence its perspective size + magnify), reading as the whole
	// graph rescaling. The scale is the documented "coarse now tick" — it advances only on first load, a scrub-cursor
	// change, or a deliberate relayout, never on a plain data arrival. Null until the first scale is built.
	zScaleCache?: { scale: TimeZScale; cursorMs: number; cursor: number | null };

	/** The quads that actually render as nodes: the time-filtered slice minus any type the user hid — the SAME gate as
	 *  visibleModel, so gantt and the force view never disagree about which graphs are shown. The gantt model MUST build
	 *  from these (not raw visibleQuads) so the time scale and lanes match exactly what's on screen. Instrumentation
	 *  graphs are hidden by default (the host derives hiddenGraphs via effectiveHiddenTypes), so they stay out of the
	 *  gantt span/lanes unless the user toggles them on. */
	renderableQuads(): TQuad[] {
		const hidden = new Set(this.deps.hiddenGraphs());
		return this.deps.visibleQuads().filter((q) => !hidden.has(q.namedGraph));
	}

	/** Hash the visible model for the unchanged-model skip. Gantt counts the time z in the hash (a reschedule moves bars
	 *  without touching nodes/links); the scrub cursor counts too (a scrub re-places every node's depth without touching
	 *  the node/link set, so a cursor-only move must still register as a change — else the skip swallows it and the view
	 *  refreshes only on an incidental resize). Both rules live HERE, not at each call site — repaint and repaintLayout
	 *  share it and can't silently diverge. */
	hashCurrentModel(nodes: FGNode[], links: FGLink[]): number {
		return hashModel(nodes, links, this.deps.viewType() === VIEW.gantt, this.deps.timeCursor());
	}

	capturePositions(): Map<string, XYZ> {
		const m = new Map<string, XYZ>();
		for (const n of this.nodeMap.values()) m.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 });
		return m;
	}

	/** Depth times per subject — the object's valid time under the valid basis, generatedAtTime under the indexed
	 *  basis (see time-axis subjectValidTimes) — each carrying the FIELD it came from for the hover label. */
	extractTimes(): TSubjectTimes {
		const indexed = LinkRelations.GENERATED_AT_TIME.rel;
		// Always compute a time (for the hover + the "label as date" toggle); only the "indexed" basis reads generatedAtTime,
		// valid AND connections use the declared valid-time field. The connections basis places depth by degree, not this.
		// The same pass says when each record was written down, which is what a reading in the order things happened
		// follows whatever places depth.
		const fieldFor = this.deps.zBasis() === "indexed" ? () => indexed : this.deps.validTimeFieldFor;
		return subjectValidTimes(this.deps.quads(), fieldFor, indexed);
	}

	/** Incident visible-link count per node — the depth value under the "# connections" z basis. Counts only edges whose
	 *  BOTH ends are in the visible node set (the same set that becomes links), so a node's degree matches what is drawn. */
	private degrees(nodeIds: Set<string>, edges: ReadonlyArray<{ from: string; to: string }>): Map<string, number> {
		const d = new Map<string, number>();
		for (const e of edges) {
			if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
			d.set(e.from, (d.get(e.from) ?? 0) + 1);
			d.set(e.to, (d.get(e.to) ?? 0) + 1);
		}
		return d;
	}

	/** Calendar placement per task, via the pure tested layout pass (computeLayout over the tasks' time roles — the one
	 *  source of the scale/lane/z/zExtent/ruler math, shared with the SVG paint). Cached in ganttTargets, which the
	 *  forces/z/paint/ghost/drag read. Only populated in "gantt" view-type; non-task nodes get no entry. */
	private recomputeGanttTargets(): void {
		if (this.deps.viewType() !== VIEW.gantt) {
			this.deps.setGanttTargets(new Map());
			this.deps.setGanttScale(undefined);
			this.deps.setGanttAdornment(null);
			this.deps.setGanttShapeSig(""); // leaving gantt → boxes revert to chips on the next feed
			return;
		}
		const tasks = quadsToGanttModel(this.renderableQuads(), { relOf: browserRelOf }).tasks;
		if (tasks.length === 0) {
			this.deps.setGanttTargets(new Map());
			this.deps.setGanttScale(undefined);
			this.deps.setGanttAdornment(null);
			this.deps.setGanttShapeSig("");
			return;
		}
		const { placements, scale, adornment } = computeLayout(tasks.map((t) => ({ id: t.id, role: { kind: "time", start: t.start, end: t.end } as const })));
		this.deps.setGanttScale(scale);
		this.deps.setGanttAdornment(adornment);
		const targets = new Map<string, GanttTarget>(
			tasks.map((t) => {
				const p = placements.get(t.id);
				// Fail-fast: every time task must get a placement; a gap is a layout bug, not something to render around.
				if (!p || p.y === undefined || p.z === undefined || p.zExtent === undefined) throw new Error(`gantt: computeLayout produced no placement for task ${t.id}`);
				return [t.id, { y: p.y, z: p.z, zLen: p.zExtent, start: t.start, end: t.end }];
			}),
		);
		this.deps.setGanttTargets(targets);
		// Bar widths (zLen, ∝ duration / span) are global — any change resizes every box, which the lib only honours on a
		// rebuild. Fingerprint the widths (full precision) so a span/duration/task-set change flags the next feed.
		this.deps.setGanttShapeSig([...targets].map(([id, t]) => `${id}:${t.zLen}`).join("|"));
	}

	toGraphData(refreshScale = false): { nodes: FGNode[]; links: FGLink[]; freshLinks: FGLink[] } {
		const { nodes, edges } = this.deps.visibleModel();
		this.recomputeGanttTargets(); // before the node loop reads ganttTargets for each node's z (the gantt time axis)
		const { times, indexed: created } = this.extractTimes();
		// Depth (z) is the pure, headless-tested time→z math (@haibun/shu/graph/time-axis.ts), referenced to "now" (a scrub
		// cursor when set). The scale is CACHED and re-derived only at the coarse-tick moments — first load, a scrub-cursor
		// move, or a deliberate relayout — NOT on a streaming merge, whose new min/max ages would otherwise reshape it and
		// teleport every settled node's depth (its camera distance → perspective size + magnify, i.e. the graph "rescaling").
		const cursor = this.deps.timeCursor(); // the cursor (null = live): the cache keys off this, never off the resolved nowRef
		const nowRef = cursor ?? Date.now(); // clock — comparing the resolved clock would re-fit every live frame (the bug).
		const cached = this.zScaleCache;
		const cursorMoved = cached !== undefined && cached.cursor !== cursor; // a scrub set/move/clear is a deliberate re-place
		// !cached IS the first-load/post-reset case (zScaleCache and the graph reset together)
		const current =
			!cached || refreshScale || cursorMoved
				? {
						scale: timeZScale(
							[...times.values()].map((t) => t.ms),
							nowRef,
							TIME_DEPTH_MAX,
						),
						cursorMs: nowRef,
						cursor,
					}
				: cached;
		this.zScaleCache = current;
		const { scale: zScale, cursorMs } = current;
		// The "# connections" z basis: depth is node degree, not time. Its scale is derived FRESH each build (unlike the
		// time scale) — degree changes only when edges do, i.e. only on a data change that already repaints, so there is
		// no per-frame teleport to guard against. HIGH degree sits toward the FRONT (small z) so hubs come forward.
		const zBasis = this.deps.zBasis();
		const degrees = zBasis === "connections" ? this.degrees(new Set(nodes.map((n) => n.id)), edges) : undefined;
		const degreeScale = degrees ? spanZScale(degrees.values(), TIME_DEPTH_MAX) : undefined;
		const viewType = this.deps.viewType();
		const flatten = this.deps.flatten();
		const grouped = this.deps.grouped();
		const groupBy = this.deps.groupBy();
		const groupAnchors = this.deps.groupAnchors();
		const groupSizes = this.deps.groupSizes();
		// Before the first paint (or after a relayout reset) everything is "new" — announce arrivals only for live additions.
		const isInitial = this.deps.lastModelHash() === undefined;
		const nextMap = new Map<string, FGNode>();
		const fgNodes: FGNode[] = [];
		const unseeded: FGNode[] = []; // newcomers with no position yet (ungrouped, or grouped with no anchor) — seeded from neighbours below
		// Per grouped node, its stable index within its group + the group size — the deterministic in-cell grid seed reads
		// these so members land on a fixed √count grid (no Math.random), and the cohesion + collide then only refine.
		const groupIndex = new Map<string, { i: number; c: number }>();
		if (grouped) {
			const byGroup = new Map<string, string[]>();
			for (const n of nodes) {
				const k = groupKeyOf({ type: n.type, properties: n.properties }, groupBy);
				const arr = byGroup.get(k);
				if (arr) arr.push(n.id);
				else byGroup.set(k, [n.id]);
			}
			for (const ids of byGroup.values()) {
				ids.sort();
				ids.forEach((id, i) => groupIndex.set(id, { i, c: ids.length }));
			}
		}
		for (const n of nodes) {
			const label = truncateLabel(n.displayLabel ?? n.id); // bound a long base64 id so the chip can't render hundreds of units wide
			const name = n.isCluster && n.omittedCount ? `+${n.omittedCount} more` : label;
			const existing = this.nodeMap.get(n.id);
			// The deterministic PIN target. Grouped: the container cell (groupPin) wins in every view, so the member sits in
			// its shelf-packed cell and the box stays exclusive. Ungrouped: the lane pin wins — the td/lr Sugiyama {x,y} or the
			// gantt/sequence lane. Both fixed via fx/fy. The key reads n.properties so the folded role resolves here (fgNode
			// carries them below). A node with no pin keeps its parked place or seeds from a neighbour.
			const groupKey = groupKeyOf({ type: n.type, properties: n.properties }, groupBy);
			const anchor = grouped ? groupAnchors.get(groupKey) : undefined;
			const size = anchor ? groupSizes.get(groupKey) : undefined;
			const gi = anchor ? groupIndex.get(n.id) : undefined;
			const groupPin = anchor && size && gi ? gridSlot(anchor, size, gi.i, gi.c) : undefined;
			// A node the user dragged stays where they dropped it, in every view: a placement by hand is a decision, and a
			// layout that puts it back rejects it. Every other node keeps the view's own deterministic pin — grouped: the
			// container cell; ungrouped: the lane.
			const pin = this.deps.userPinXY(n.id) ?? (grouped ? (groupPin ?? this.deps.lanePinXY(n.id)) : (this.deps.lanePinXY(n.id) ?? groupPin));
			const pinAt = (node: FGNode): void => {
				if (!pin) return;
				node.x = pin.x;
				node.y = pin.y;
				node.fx = pin.x; // FIX the node at its deterministic position — the force can't spread (and so overlap) a pinned node
				node.fy = pin.y;
				node.vx = 0;
				node.vy = 0;
			};
			let fgNode: FGNode;
			if (existing && existing.name === name && existing.type === n.type) {
				fgNode = existing;
				pinAt(fgNode);
			} else if (existing) {
				const { x, y, z, vx, vy, vz } = existing;
				fgNode = { id: n.id, name, type: n.type, isCluster: n.isCluster, x, y, z, vx, vy, vz };
				pinAt(fgNode);
			} else {
				fgNode = { id: n.id, name, type: n.type, isCluster: n.isCluster };
				const parked = this.parkedPositions.get(n.id);
				if (parked) this.parkedPositions.delete(n.id);
				if (pin) pinAt(fgNode);
				else if (parked) {
					fgNode.x = parked.x;
					fgNode.y = parked.y;
				} else {
					unseeded.push(fgNode); // ungrouped (or no anchor): seed from a placed neighbour once links are known
				}
				if (!isInitial) {
					fgNode.__k = 0.25; // newly arrived: grow in with the cartoon pop once its sprite exists
					this.deps.startNewcomerPop(fgNode);
				}
			}
			fgNode.properties = n.properties; // carry the model node's properties (incl the folded HypermediaRole) so groupKeyOf(fgNode, "role") resolves
			const subjectTime = times.get(n.id); // the node's time — surfaced on hover + the "label as date" toggle, and the depth value under a time basis
			fgNode.__t = subjectTime?.ms;
			fgNode.__tField = subjectTime?.field;
			fgNode.__created = created.get(n.id)?.ms;
			fgNode.__degree = degrees ? (degrees.get(n.id) ?? 0) : undefined;
			// The depth value: under the "# connections" basis it is node degree (high degree → front, small z); otherwise
			// the recorded-time (sqrt-age) depth. A newcomer outside the cached age range (older than max → z>zMax behind the
			// camera, or newer than min → z<0) clamps to the plane until the next coarse-tick recompute re-fits the scale.
			const depthZ = degreeScale ? TIME_DEPTH_MAX - spanZ(fgNode.__degree ?? 0, degreeScale) : Math.min(TIME_DEPTH_MAX, timeZ(fgNode.__t ?? cursorMs, cursorMs, zScale));
			// z is the time axis. gantt/sequence place it on a LINEAR calendar (lane z); td/lr COMPRESS it so the rank
			// structure dominates and the ranks pack close (a subtle depth cue, not flat); the force family uses the full
			// sqrt-age depth; flatten collapses everything to one plane.
			if (isSchemaType(n.type))
				fgNode.z = 0; // schema is timeless: pinned to the front z=0 plane, off the sqrt-age axis (its t=0 would otherwise sink it to zMax)
			else if (flatten) fgNode.z = 0;
			else if (viewType === VIEW.gantt || viewType === VIEW.sequence) fgNode.z = this.deps.laneZ(n.id) ?? 0;
			else if (viewType === VIEW.td || viewType === VIEW.lr) fgNode.z = depthZ * LAYERED_Z_FACTOR;
			else fgNode.z = depthZ;
			nextMap.set(n.id, fgNode);
			fgNodes.push(fgNode);
		}
		// Park positions of nodes leaving the visible set so they can re-enter in place.
		for (const [id, n] of this.nodeMap) {
			if (!nextMap.has(id) && n.x !== undefined && n.y !== undefined) this.parkedPositions.set(id, { x: n.x, y: n.y });
		}
		this.nodeMap = nextMap;
		const ids = new Set(fgNodes.map((n) => n.id));
		// Reuse existing FGLink objects so __lineObj / __labelSprite are never orphaned by a repaint — losing
		// those refs forces applyFocus to retry 30 frames before it can highlight incident edges.
		// Fresh = absent from the previous linkMap; detecting here avoids a second pass.
		const prevLinkMap = this.linkMap;
		const freshLinks: FGLink[] = [];
		const nextLinkMap = new Map<string, FGLink>();
		const links: FGLink[] = edges
			.filter((ed) => ids.has(ed.from) && ids.has(ed.to))
			.map((ed) => {
				const k = linkKey({ source: ed.from, target: ed.to, predicate: ed.predicate });
				const l = prevLinkMap.get(k) ?? { source: ed.from, target: ed.to, predicate: ed.predicate };
				nextLinkMap.set(k, l);
				if (!isInitial && !prevLinkMap.has(k)) freshLinks.push(l);
				return l;
			});
		this.linkMap = nextLinkMap;
		if (unseeded.length) this.seedNewcomers(unseeded, links);
		return { nodes: fgNodes, links, freshLinks };
	}

	/**
	 * Place newcomers next to where they belong so they ease in instead of flying from the origin (the "jiggling mess"
	 * when many of a type stream in): near a connected, already-placed neighbour; else near the centroid of placed
	 * same-type nodes; else left at the origin. A small jitter keeps coincident newcomers from exploding off each other.
	 */
	private seedNewcomers(newcomers: FGNode[], links: FGLink[]): void {
		const placed = (id: string): { x: number; y: number } | undefined => {
			const n = this.nodeMap.get(id);
			return n && n.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y } : undefined;
		};
		const newIds = new Set(newcomers.map((n) => n.id));
		const neighbours = new Map<string, string[]>();
		const addNeighbour = (k: string, v: string): void => {
			const a = neighbours.get(k);
			if (a) a.push(v);
			else neighbours.set(k, [v]);
		};
		for (const l of links) {
			const s = linkEndId(l.source);
			const t = linkEndId(l.target);
			if (newIds.has(s)) addNeighbour(s, t);
			if (newIds.has(t)) addNeighbour(t, s);
		}
		const typeCentroids = new Map<string, { x: number; y: number; n: number }>();
		for (const n of this.nodeMap.values()) {
			if (newIds.has(n.id) || n.x === undefined || n.y === undefined) continue;
			const c = typeCentroids.get(n.type) ?? { x: 0, y: 0, n: 0 };
			c.x += n.x;
			c.y += n.y;
			c.n += 1;
			typeCentroids.set(n.type, c);
		}
		const jitter = (): number => (Math.random() - 0.5) * 2 * NEWCOMER_SEED_SPREAD;
		for (const n of newcomers) {
			let base: { x: number; y: number } | undefined;
			for (const m of neighbours.get(n.id) ?? []) {
				base = placed(m);
				if (base) break;
			}
			if (!base) {
				const c = typeCentroids.get(n.type);
				if (c) base = { x: c.x / c.n, y: c.y / c.n };
			}
			if (!base) continue; // truly isolated first-of-its-kind — the lib's default placement is fine
			n.x = base.x + jitter();
			n.y = base.y + jitter();
		}
	}
}
