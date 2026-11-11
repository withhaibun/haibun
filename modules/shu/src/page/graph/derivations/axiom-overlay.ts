/**
 * The graph's DL view: the axioms of what the graph shows, mapped onto the same nodes and edges the scene draws. An individual
 * carries the type its record asserts (∈) and the types the ontology entails (⊨ ∈), a Class or Property record carries its
 * class's or property's axioms, and an edge carries its property's. A refused claim's witness marks in place the records that exceed its subsumption (∉) and
 * the class it names (⋢), a claim K contradicts marks the individual, the two disjoint classes and the disjointness between them
 * with the vocabulary that states it, and a derivation's witness marks the records its proof wrote with the axioms of their frames. A node or
 * an edge the scene doesn't draw doesn't carry an axiom.
 */
import { DL_SYMBOL, FRAME_KIND, type TClaimWitness, type TDisjointnessWitness, type TFrame, type TGraphAxioms } from "@haibun/core/lib/records/domains/axioms.js";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { BETWEEN_AXIOMS } from "@haibun/core/lib/records/derivations/axioms.js";
import { edgeKey } from "./focus-policy.js";
import type { TDrawn } from "./source-lines.js";

/** The axioms a node or an edge carries, and the frame of the source that states them. */
export type TCarried = { lines: string[]; frame: string };
/** The axioms each node and each edge of a graph carries, by node id and by edge key, and the nodes a refused claim's witness
 *  names, which the scene lights. */
export type TAxiomOverlay = { nodes: ReadonlyMap<string, TCarried>; edges: ReadonlyMap<string, TCarried>; witnessed: ReadonlySet<string> };
/** What a step end names as its witness: a refused claim's, or the frames of the records a derivation's proof wrote. */
export type TWitness = { claim: TClaimWitness } | { disjointness: TDisjointnessWitness } | { proof: readonly TFrame[] };

/** Returns the axioms `axioms` states for each node and edge the scene draws, keyed by the scene's ids and edge keys, with the
 *  marks of a `witness` where there is one. */
export function axiomOverlay(drawn: TDrawn, axioms: TGraphAxioms, witness: TWitness | undefined): TAxiomOverlay {
	const drawnNodes = new Set(drawn.nodes);
	const drawnEdges = new Set(drawn.edges.map(({ from, predicate, to }) => edgeKey(from, predicate, to)));
	const nodes = new Map<string, TCarried>();
	const edges = new Map<string, TCarried>();
	// A node that two frames state, a Class record as a class and as an individual, carries both frames' axioms and opens the first.
	const carry = (held: Map<string, TCarried>, key: string, lines: string[], frame: string): void => {
		const carried = held.get(key);
		held.set(key, carried === undefined ? { lines, frame } : { lines: [...carried.lines, ...lines], frame: carried.frame });
	};
	for (const frame of axioms.frames) {
		if (frame.kind === FRAME_KIND.individual) {
			const [id] = frame.nodes;
			if (id === undefined || !drawnNodes.has(id) || frame.assertedBy === undefined) continue;
			const entailed = frame.entailed === undefined ? [] : frame.entailed;
			carry(nodes, id, [`${DL_SYMBOL.member} ${frame.assertedBy.persistedAs}`, ...entailed.map((type) => `${DL_SYMBOL.entails} ${DL_SYMBOL.member} ${type}`)], frame.name);
			continue;
		}
		// A class or property frame carries its axioms on the Class or Property record it states, and on each edge of its
		// property; a type's records carry their types.
		const lines = frame.dl.split(BETWEEN_AXIOMS);
		for (const id of frame.nodes) if (drawnNodes.has(id) && frame.name === `${frame.kind} ${id}`) carry(nodes, id, lines, frame.name);
		for (const { from, label, to } of frame.edges) {
			const key = edgeKey(from, label, to);
			if (drawnEdges.has(key)) carry(edges, key, lines, frame.name);
		}
	}
	const witnessed = new Set<string>();
	const mark = (id: string, lines: string[], kind: string): void => {
		if (!drawnNodes.has(id)) return;
		carry(nodes, id, lines, `${kind} ${id}`);
		witnessed.add(id);
	};
	if (witness !== undefined && "claim" in witness) {
		const { members, sub, sup } = witness.claim;
		for (const { id } of members) mark(id, [`${DL_SYMBOL.notMember} ${sup}`], FRAME_KIND.individual);
		mark(sub, [`${sub} ${DL_SYMBOL.notSubsumedBy} ${sup}`], FRAME_KIND.class);
	} else if (witness !== undefined && "disjointness" in witness) {
		const { individual, disjoint, statedBy } = witness.disjointness;
		const [a, b] = disjoint;
		const axiom = `${a} ${DL_SYMBOL.intersection} ${b} ${DL_SYMBOL.subsumedBy} ${DL_SYMBOL.bottom} (${statedBy})`;
		mark(individual.id, [`${DL_SYMBOL.member} ${a}`, `${DL_SYMBOL.member} ${b}`, axiom], FRAME_KIND.individual);
		for (const cls of disjoint) mark(cls, [axiom], FRAME_KIND.class);
		for (const key of [edgeKey(a, LinkRelations.DISJOINT_WITH.rel, b), edgeKey(b, LinkRelations.DISJOINT_WITH.rel, a)])
			if (drawnEdges.has(key)) carry(edges, key, [axiom], `${FRAME_KIND.class} ${a}`);
	} else if (witness !== undefined) for (const frame of witness.proof) for (const id of frame.nodes) mark(id, frame.dl.split(BETWEEN_AXIOMS), frame.kind);
	return { nodes, edges, witnessed };
}

/** A chip's or an edge's text with the axioms it carries, a line each under it. */
export const withAxioms = (text: string, carried: TCarried | undefined): string => (carried === undefined ? text : [text, ...carried.lines].join("\n"));

/** Whether two overlays carry the same axioms on the same nodes and edges, so a scene that already draws one isn't redrawn. */
export const sameOverlay = (a: TAxiomOverlay | null, b: TAxiomOverlay | null): boolean => {
	const key = (overlay: TAxiomOverlay | null): string => (overlay === null ? "" : JSON.stringify([[...overlay.nodes], [...overlay.edges], [...overlay.witnessed]]));
	return key(a) === key(b);
};
