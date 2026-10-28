/**
 * A record's neighbourhood as quads: the record, each record one edge away in either direction, and the edges between
 * them, so a reader's choice of a record brings its surroundings into the graph. Each neighbour arrives as its own node,
 * not merely an edge's end, and every record named is pinned, so streamed data doesn't evict what the reader revealed.
 */
import type { TIncomingEdges, TIndividualWithEdges, TQuad } from "@haibun/core/lib/quad-types.js";
import { isProjectionKey } from "@haibun/core/lib/quad-types.js";

/** The page of edges that reach a record, which the site caps, so a hub stays bounded. */
export const INCOMING_LIMIT = 100;

/** What a neighbourhood brings: its quads, the subjects to pin, and the types it touched, which a view expands. */
export type TNeighbourhood = { quads: TQuad[]; pinned: Set<string>; types: Set<string> };

/** A record's id, by the id field its type declares. */
type TIdOf = (vertex: Record<string, unknown>) => string;

/** A record's scalar properties as quads, without its edges, so a revealed neighbour renders as a node. */
function vertexQuads(label: string, vertex: Record<string, unknown>, idOf: TIdOf, timestamp: number): TQuad[] {
	const subject = idOf(vertex);
	if (!subject) return [];
	return Object.entries(vertex)
		.filter(([k, v]) => !isProjectionKey(k) && k !== "id" && v !== undefined && v !== null)
		.map(([predicate, object]) => ({ subject, predicate, object, namedGraph: label, timestamp }));
}

/** The type and id of the record at an edge's other end, or undefined for a record that lacks either. */
function endOf(target: Record<string, unknown>, idOf: TIdOf): { label: string; id: string } | undefined {
	const label = target["@type"];
	const id = idOf(target);
	return typeof label === "string" && label !== "" && id !== "" ? { label, id } : undefined;
}

/** The neighbourhood of the record `label` `id` names, from the record with its edges and the edges that reach it. */
export function neighbourhoodOf(label: string, id: string, individual: TIndividualWithEdges, incoming: TIncomingEdges, idOf: TIdOf, timestamp: number): TNeighbourhood {
	const quads = vertexQuads(label, individual.vertex, idOf, timestamp);
	const pinned = new Set<string>([id]);
	const types = new Set<string>([label]);
	for (const e of individual.edges.filter((edge) => edge.direction === "out")) {
		const end = endOf(e.target, idOf);
		if (end === undefined) continue;
		quads.push({ subject: id, predicate: e.type, object: end.id, namedGraph: label, objectType: end.label, timestamp }, ...vertexQuads(end.label, e.target, idOf, timestamp));
		pinned.add(end.id);
		types.add(end.label);
	}
	for (const e of incoming.edges) {
		const end = endOf(e.target, idOf);
		if (end === undefined) continue;
		quads.push({ subject: end.id, predicate: e.type, object: id, namedGraph: end.label, objectType: label, timestamp }, ...vertexQuads(end.label, e.target, idOf, timestamp));
		pinned.add(end.id);
		types.add(end.label);
	}
	return { quads, pinned, types };
}
