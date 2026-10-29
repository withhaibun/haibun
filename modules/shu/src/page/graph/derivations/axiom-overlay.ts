/**
 * The graph's DL view: the axioms of what the graph shows, mapped onto the same nodes and edges the scene draws. An individual
 * carries the type its record asserts (∈) and the types the ontology entails (⊨ ∈), a Class record carries its class's axioms,
 * and an edge carries its property's. A node or an edge the scene doesn't draw doesn't carry an axiom.
 */
import { FRAME_KIND, type TGraphAxioms } from "@haibun/core/lib/records/domains/axioms.js";
import { BETWEEN_AXIOMS } from "@haibun/core/lib/records/derivations/axioms.js";
import { edgeKey } from "./focus-policy.js";
import type { TDrawn } from "./source-lines.js";

/** The axioms a node or an edge carries, and the frame of the source that states them. */
export type TCarried = { lines: string[]; frame: string };
/** The axioms each node and each edge of a graph carries, by node id and by edge key. */
export type TAxiomOverlay = { nodes: ReadonlyMap<string, TCarried>; edges: ReadonlyMap<string, TCarried> };

/** The mark of a type the ontology entails of an individual, which its record doesn't assert. */
export const ENTAILED_MARK = "⊨";

/** Returns the axioms `axioms` states for each node and edge the scene draws, keyed by the scene's ids and edge keys. */
export function axiomOverlay(drawn: TDrawn, axioms: TGraphAxioms): TAxiomOverlay {
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
			carry(nodes, id, [`∈ ${frame.assertedBy.persistedAs}`, ...entailed.map((type) => `${ENTAILED_MARK} ∈ ${type}`)], frame.name);
		} else if (frame.kind === FRAME_KIND.class) {
			// A class frame carries its axioms on the Class record that is the class; a type's records carry their types.
			for (const id of frame.nodes) if (drawnNodes.has(id) && frame.name === `${FRAME_KIND.class} ${id}`) carry(nodes, id, frame.dl.split(BETWEEN_AXIOMS), frame.name);
		} else
			for (const { from, label, to } of frame.edges) {
				const key = edgeKey(from, label, to);
				if (drawnEdges.has(key)) carry(edges, key, frame.dl.split(BETWEEN_AXIOMS), frame.name);
			}
	}
	return { nodes, edges };
}

/** A chip's or an edge's text with the axioms it carries, a line each under it. */
export const withAxioms = (text: string, carried: TCarried | undefined): string => (carried === undefined ? text : [text, ...carried.lines].join("\n"));

/** Whether two overlays carry the same axioms on the same nodes and edges, so a scene that already draws one isn't redrawn. */
export const sameOverlay = (a: TAxiomOverlay | null, b: TAxiomOverlay | null): boolean => {
	const key = (overlay: TAxiomOverlay | null): string => (overlay === null ? "" : JSON.stringify([[...overlay.nodes], [...overlay.edges]]));
	return key(a) === key(b);
};
