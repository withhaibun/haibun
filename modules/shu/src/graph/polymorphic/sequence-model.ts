/**
 * Graph → sequence-diagram model (pure, GPU-free): the §4 sequence/lifecycle read of the graph. Two products from one
 * derivation: the protocol model `TSeqModel` ({ actors, messages }) and the 3D classic-sequence layout
 * (mapGraphToSeqLayout: participant agents become lifelines, messages become arrows between them along the shared z time
 * axis). Both are fed from the GRAPH, not from traces.
 *
 * A classic sequence diagram is AGENTS + MESSAGES. The participants (lifelines) are the agent NODES themselves: the
 * parties an artifact points to through a directional actor edge, never a role-grouping container. The messages are
 * ARTIFACT-MEDIATED and fully general (no per-type knowledge): an entity carrying a `fromActor` edge (its SOURCE
 * agent) AND a `toActor` edge (its DESTINATION agent) reads as one message source → destination, at the entity's time,
 * labelled by the entity. The artifact itself is the message, not a lifeline. Both edge-label sets are derived from
 * the ontology + concern catalog (rels-cache fromActorEdgeLabels/toActorEdgeLabels, core rels `subPropertyOf`
 * fromActor/toActor plus every consumer edge declared with those upper pointers), so a new actor predicate needs
 * nothing here.
 *
 * Unit-tested without a scene (see sequence-model.test.ts).
 */
import { fromActorEdgeLabels, toActorEdgeLabels } from "../../rels-cache.js";
import { collideRadius } from "./layout-forces.js";
import type { TSeqModel, TSeqMessage, TSeqActor } from "../sequence-model-types.js";

export type { TSeqModel, TSeqMessage, TSeqActor } from "../sequence-model-types.js";

/** A graph node the mapper reads: its id, @type, display label, and recorded time. (`properties` is accepted for the
 *  host's shared node shape but the sequence read derives everything from the directional actor EDGES, not properties.) */
export type SeqNode = { id: string; type: string; displayLabel?: string; properties?: Record<string, unknown>; __t?: number };
/** A graph edge: subject → object under a predicate. An actor edge points from an artifact TO an agent. */
export type SeqEdge = { from: string; to: string; predicate: string };

/** Options the host injects: the display label for a participant id (defaults to the id), lets the live view resolve a
 *  DID → "Coastal Fisheries Authority". A message is labelled by its mediating artifact's @type, never an edge predicate,
 *  so no predicate resolver is needed here. */
export type SeqMapOptions = {
	labelOf?: (participantId: string) => string;
};

/** The label for an artifact-mediated message: the mediating entity's @type (e.g. "VerifiablePresentation"), never a
 *  predicate and never its displayLabel (which for a credential is its raw claims): the artifact's TYPE is the message. */
const artifactLabel = (n: SeqNode): string => n.type || n.id;

const finiteTime = (t: number | undefined): number => (typeof t === "number" && Number.isFinite(t) ? t : Number.POSITIVE_INFINITY);

/** One artifact-mediated message before ordering: the resolved source/destination agents, the mediating artifact, its time. */
type DerivedMessage = { from: string; to: string; label: string; kind: "call"; t: number; artifactId: string };

/** The shared derivation both products read. Walks the directional actor edges to find, per artifact, the agents it
 *  originates FROM and is directed TO; each (source, destination) pair is a message. Participants are exactly the agents
 *  some message touches, ordered by first involvement time (ties by id) so the earliest party heads the diagram. */
function deriveSeq(
	nodes: ReadonlyArray<SeqNode>,
	edges: ReadonlyArray<SeqEdge>,
	opts: SeqMapOptions,
): { actors: TSeqActor[]; messages: DerivedMessage[]; barOf: Map<string, string> } {
	const labelOf = opts.labelOf ?? ((id: string) => id);
	const byId = new Map(nodes.map((n) => [n.id, n] as const));

	// Actors are ordered by FIRST INVOLVEMENT, which is the order their lifelines stand in, left to right.
	const earliest = new Map<string, number>();
	const involve = (id: string, t: number) => {
		const e = earliest.get(id);
		if (e === undefined || t < e) earliest.set(id, t);
	};

	// Per artifact: the agents it originates from (fromActor) and is directed to (toActor). The agent must be a visible
	// node, and IS a participant the moment an actor edge points to it (seeded with its own creation time).
	const srcOf = new Map<string, Set<string>>();
	const dstOf = new Map<string, Set<string>>();
	const add = (m: Map<string, Set<string>>, k: string, v: string) => {
		let s = m.get(k);
		if (!s) m.set(k, (s = new Set<string>()));
		s.add(v);
	};
	// Read at map time (not module scope): the concern catalog supplies consumer-declared actor edges once populated.
	const fromActorSet = fromActorEdgeLabels();
	const toActorSet = toActorEdgeLabels();
	for (const e of edges) {
		if (!byId.has(e.to)) continue;
		if (fromActorSet.has(e.predicate)) add(srcOf, e.from, e.to);
		else if (toActorSet.has(e.predicate)) add(dstOf, e.from, e.to);
		else continue;
		involve(e.to, finiteTime(byId.get(e.to)?.__t));
	}
	const derived: DerivedMessage[] = [];
	for (const [artifactId, srcs] of srcOf) {
		const dsts = dstOf.get(artifactId);
		if (!dsts) continue; // needs both a source and a destination to be a message
		const a = byId.get(artifactId);
		if (!a) continue; // the mediating artifact must be a visible node to time + label its message
		const t = finiteTime(a.__t);
		const label = artifactLabel(a);
		for (const s of srcs)
			for (const d of dsts) {
				if (s === d) continue;
				derived.push({ from: s, to: d, label, kind: "call", t, artifactId });
				involve(s, t);
				involve(d, t);
			}
	}

	const actorIds = [...earliest.keys()].sort((a, b) => (earliest.get(a) ?? 0) - (earliest.get(b) ?? 0) || a.localeCompare(b));
	const actors = actorIds.map((id) => ({ id, label: labelOf(id) }));
	derived.sort((a, b) => a.t - b.t);

	// Which bar each object belongs to. ONE actor link is enough: an object attributed to an agent belongs against that
	// agent's bar whether or not it also addresses a second one. Requiring both (a message) left everything that names a
	// single actor, most of a discourse graph, with nowhere to go.
	const isActor = new Set(actorIds);
	const barOf = new Map<string, string>();
	const claim = (objectId: string, actorId: string) => {
		if (isActor.has(objectId) || barOf.has(objectId) || !isActor.has(actorId)) return;
		barOf.set(objectId, actorId);
	};
	for (const [objectId, srcs] of srcOf) for (const s of srcs) claim(objectId, s); // the bar it came FROM wins
	for (const [objectId, dsts] of dstOf) for (const d of dsts) claim(objectId, d); // else the bar it addresses
	return { actors, messages: derived, barOf };
}

/**
 * Map the visible graph to a sequence model: actors are the participant AGENT nodes (the parties artifacts point to via
 * directional actor edges), messages are the artifact-mediated source → destination calls, time-ordered; identical
 * adjacent messages are deduped (the same step reached twice).
 */
export function mapGraphToSeq(nodes: ReadonlyArray<SeqNode>, edges: ReadonlyArray<SeqEdge>, opts: SeqMapOptions = {}): TSeqModel {
	const { actors, messages: derived } = deriveSeq(nodes, edges, opts);
	const messages: TSeqMessage[] = [];
	for (const d of derived) {
		const prev = messages[messages.length - 1];
		if (prev && prev.from === d.from && prev.to === d.to && prev.label === d.label && prev.kind === d.kind) continue;
		messages.push({ from: d.from, to: d.to, label: d.label, kind: d.kind });
	}
	return { actors, messages };
}

// --- 3D layout (the classic sequence in polymorphic space) ---
// Lifelines are LANES across y, one per actor, standing left to right in order of first appearance; time is the Z axis
// (the SAME z gantt uses), read DOWN. An actor renders as a GANTT DURATION BAR, the very primitive gantt uses, spanning
// the rows of its own objects, and each object stands on the lifeline it names at its own row, so reading down a lifeline
// is that actor's objects in order. An object naming two actors also draws the arrow between their lifelines.

/** y spacing between participant lifelines (lanes). Wide enough that arrows between adjacent lifelines read clearly. */
export const SEQ_LANE_SPACING = 70;
/** z length of the time axis when nothing places on it (no messages). */
export const SEQ_TIME_LEN = 240;
/** z between consecutive message rows. A sequence diagram is ORDINAL: one row per message, evenly spaced in time
 *  order: wall-clock gaps carry no length, so a burst within one second reads as its rows, not as a pile. */
export const SEQ_ROW_GAP = 12;
/** Clear space between one lifeline and the next, on top of the widest chip standing against each. */
const SEQ_LANE_GAP = 24;

/** A node's 3D placement in the sequence: its y (the lifeline it stands on, or the margin lane) and z (its row). */
export type SeqPlacement = { y: number; z: number };
/** A message arrow: the source/destination lifeline ys and the time-z it is drawn at, plus its label. */
export type SeqArrow = { from: string; to: string; label: string; fromY: number; toY: number; z: number };
/** A participant's lifeline extent along the time axis: the z of its first (z0) and last (z1) involvement. The lifeline
 *  is a gantt duration bar spanning [z0,z1]: the actor renders as a box mark of that length, centred at (z0+z1)/2. */
export type SeqSpan = { z0: number; z1: number };
/** The full 3D sequence layout: the ordered participant actors, each actor's lane y (the lifeline source), each placed
 *  node's position (agents centre on their active-window lifeline; artifacts ride their arrow), each actor's lifeline
 *  span, the message arrows, and the framing extents. */
export type SeqLayout = {
	/** Which bar each object belongs to (absent = no part in the exchange, so it rests on the margin lane). */
	barOf: Map<string, string>;
	actors: TSeqActor[];
	laneY: Map<string, number>;
	placement: Map<string, SeqPlacement>;
	spans: Map<string, SeqSpan>;
	arrows: SeqArrow[];
	laneSpan: number;
	timeSpan: number;
};

/**
 * Place the graph as a 3D classic sequence: agents become lifelines centred on y (mapGraphToSeq's first-involvement
 * order), each at z=0; each artifact that mediates a message rides the midpoint between its source/destination lifelines
 * at the message's time-z; messages become arrows between the lifelines at that z. Pure + GPU-free (unit-tested): the
 * render type caches it and reads placement(id) for the force lane + node-z, and arrows for the drawn message lines.
 */
export function mapGraphToSeqLayout(nodes: ReadonlyArray<SeqNode>, edges: ReadonlyArray<SeqEdge>, opts: SeqMapOptions = {}): SeqLayout {
	const { actors, messages, barOf } = deriveSeq(nodes, edges, opts);
	// LANES are the lifelines, left to right in order of first appearance (deriveSeq orders the actors that way). Each
	// lane is spaced to clear the WIDEST chip standing against it, since an object's chip reads across the lane axis: a
	// fixed spacing put a sentence-long chip through its neighbour's lifeline.
	const laneY = new Map<string, number>();
	const widestOn = new Map<string, number>();
	const halfWidth = (n: SeqNode) => collideRadius({ name: opts.labelOf?.(n.id) || artifactLabel(n), isCluster: false });

	// ONE time axis for every object, bar or no bar: each takes a ROW of its own, in order of appearance, and time reads
	// DOWN: the way a sequence diagram is read. Rows are ordinal, so two acts in one second are two rows and a long
	// pause is no taller than a short one.
	const isActor = new Set(actors.map((a) => a.id));
	const objects = nodes.filter((n) => !isActor.has(n.id)).sort((a, b) => finiteTime(a.__t) - finiteTime(b.__t) || a.id.localeCompare(b.id));
	const rowOf = new Map<string, number>(objects.map((n, i) => [n.id, i * SEQ_ROW_GAP]));

	// Lane positions: each lifeline stands clear of the widest chip on the lane before it.
	const MARGIN_LANE = "";
	for (const n of objects) {
		const lane = barOf.get(n.id) ?? MARGIN_LANE;
		widestOn.set(lane, Math.max(widestOn.get(lane) ?? 0, halfWidth(n)));
	}
	let laneCursor = 0;
	for (const lane of [MARGIN_LANE, ...actors.map((a) => a.id)]) {
		const half = Math.max(widestOn.get(lane) ?? 0, SEQ_LANE_SPACING / 2);
		laneCursor += half;
		laneY.set(lane, laneCursor);
		laneCursor += half + SEQ_LANE_GAP;
	}
	const marginY = laneY.get(MARGIN_LANE) ?? 0;
	laneY.delete(MARGIN_LANE);

	// Each lifeline spans the rows of its OWN objects: reading down it is that actor's objects, in order.
	const placement = new Map<string, SeqPlacement>();
	const spans = new Map<string, SeqSpan>();
	const rowsOn = new Map<string, { z0: number; z1: number }>();
	for (const n of objects) {
		const bar = barOf.get(n.id);
		const z = rowOf.get(n.id) ?? 0;
		if (bar === undefined) continue;
		const seen = rowsOn.get(bar);
		if (seen)
			seen.z1 = z; // objects walk in row order, so the last one seen closes the span
		else rowsOn.set(bar, { z0: z, z1: z });
	}
	for (const a of actors) {
		const { z0, z1 } = rowsOn.get(a.id) ?? { z0: 0, z1: 0 };
		spans.set(a.id, { z0, z1 });
		placement.set(a.id, { y: laneY.get(a.id) ?? 0, z: (z0 + z1) / 2 });
	}

	// An object stands on the lifeline it names, at its own row; one that names no VISIBLE actor keeps its row on a lane
	// of its own, outside them: the graph's own order, still read down, rather than a heap at the axis start.
	for (const n of objects) {
		const lane = laneY.get(barOf.get(n.id) ?? "");
		placement.set(n.id, { y: lane ?? marginY, z: rowOf.get(n.id) ?? 0 });
	}

	// An object that names TWO actors also draws the arrow between their lifelines, at its own row.
	const arrows: SeqArrow[] = [];
	for (const m of messages) {
		const fromY = laneY.get(m.from);
		const toY = laneY.get(m.to);
		if (fromY === undefined || toY === undefined) continue;
		arrows.push({ from: m.from, to: m.to, label: m.label, fromY, toY, z: rowOf.get(m.artifactId) ?? 0 });
	}

	const timeSpan = objects.length > 1 ? (objects.length - 1) * SEQ_ROW_GAP : SEQ_TIME_LEN;
	return { actors, barOf, laneY, placement, spans, arrows, laneSpan: Math.max(laneCursor, SEQ_LANE_SPACING), timeSpan };
}

/** Each participant's bar and what sits on it, in the order the layout placed them: what an accessible reading of a
 *  sequence walks, and what a still image draws as the lanes. Empty bars are kept, since a participant with nothing
 *  on it is itself worth reading. */
export function actorBars(layout: SeqLayout): Array<{ id: string; label: string; nodeIds: string[] }> {
	const onBar = new Map<string, string[]>(layout.actors.map((a): [string, string[]] => [a.id, []]));
	for (const id of layout.placement.keys()) {
		const bar = layout.barOf.get(id);
		if (bar !== undefined) onBar.get(bar)?.push(id);
	}
	return layout.actors.map((a) => ({ id: a.id, label: a.label, nodeIds: onBar.get(a.id) ?? [] }));
}
