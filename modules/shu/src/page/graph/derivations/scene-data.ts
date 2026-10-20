/**
 * What the graph scene shows, derived from what it is given: the visible model, and the hash of the inputs that model and
 * its placement read. A repaint compares the hash before it builds a model, so a batch that leaves the visible set as it
 * was doesn't build one (PF31).
 */
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import type { GraphModel } from "../../../domains/graph-model.js";
import { buildGraphModelFromQuads } from "../../../derivations/graph-model.js";
import { stableHash } from "./model-hash.js";

/** What the visible model reads: the quads and clusters, the types and predicates hidden, the prune, and the site. */
export type TVisibleModelInput = {
	/** The time-visible slice of the snapshot: the cursor has already hidden what is not yet current. */
	quads: readonly TQuad[];
	clusters: readonly TCluster[];
	/** Node types the person put away: a whole named graph goes, including instrumentation, which is a chip like any other. */
	hiddenGraphs: readonly string[];
	/** Predicates the person put away: a node whose every edge is hidden is edgeless for the prune. */
	hiddenPredicates: readonly string[];
	/** Drop the nodes that links don't connect: a graph of unconnected chips shows less than the connections between them. */
	prune: boolean;
	site?: string;
	roleRels: readonly string[];
};

/** The scene's inputs: what the visible model reads, and what places it, the view, its layout options and the time cursor. */
export type TSceneData = TVisibleModelInput & {
	viewType: string;
	/** The layout options a view reads, each a word or a switch. */
	options: Readonly<Record<string, string | boolean>>;
	timeCursor: number | null;
};

/** The visible model and how many nodes prune took out of it. */
export type TVisibleGraph = { model: GraphModel; pruned: number };

/**
 * The one derivation of what is shown, in the order the filters compose: hidden types out, hidden predicates out,
 * then the prune over what is left. Every consumer reads it (the draw, the sequence mapper, the still image, the
 * JSON-LD, the accessible document), so one filter shows the same graph in every medium.
 */
export function visibleGraph({ quads, clusters, hiddenGraphs, hiddenPredicates, prune, site, roleRels }: TVisibleModelInput): TVisibleGraph {
	const hidden = new Set(hiddenGraphs);
	let built = buildGraphModelFromQuads(
		quads.filter((q) => !hidden.has(q.namedGraph)),
		{ clusters: clusters.filter((c) => !hidden.has(c.type)), roleRels, site },
	);
	if (hiddenPredicates.length) {
		const hiddenPred = new Set(hiddenPredicates);
		built = { ...built, edges: built.edges.filter((e) => !hiddenPred.has(e.predicate)) };
	}
	let pruned = 0;
	if (prune) {
		const linked = new Set<string>();
		for (const e of built.edges) {
			linked.add(e.from);
			linked.add(e.to);
		}
		const kept = built.nodes.filter((n) => linked.has(n.id));
		pruned = built.nodes.length - kept.length;
		built = { ...built, nodes: kept };
	}
	return { model: built, pruned };
}

/** The visible model of `visibleGraph`, without the count of the nodes prune took out. */
export const visibleGraphModel = (input: TVisibleModelInput): GraphModel => visibleGraph(input).model;

/** The hash of the scene's inputs, over the quads and clusters of the types shown, so a batch that brings only quads of a
 *  hidden type hashes as the scene it leaves unchanged. */
export function sceneDataHash(data: TSceneData): number {
	const hidden = new Set(data.hiddenGraphs);
	return stableHash((mix) => {
		for (const q of data.quads) if (!hidden.has(q.namedGraph)) mix(JSON.stringify(q));
		for (const c of data.clusters) if (!hidden.has(c.type)) mix(JSON.stringify(c));
		mix(JSON.stringify([data.hiddenGraphs, data.hiddenPredicates, data.prune, data.site, data.roleRels, data.viewType, data.options, data.timeCursor]));
	});
}
