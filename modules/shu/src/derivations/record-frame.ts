/**
 * The frame that states a Class or Property record, as the graph's axioms state it. The record is a graph of one node, and its
 * fields and its outgoing edges are the ontology's statements of its name.
 */
import { CLASS_LABEL, PROPERTY_LABEL } from "@haibun/core/lib/domains/resources.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { BETWEEN_AXIOMS, frameStating } from "@haibun/core/lib/records/derivations/axioms.js";
import type { TIndividualWithEdges } from "@haibun/core/lib/quad-types.js";
import type { TRecordFrame } from "@haibun/core/lib/records/domains/axioms.js";
import { graphAxioms, type TOntologyStatement } from "./graph-axioms.js";

/** The types whose records state a frame of their own: a Class record is a class, and a Property record is a property. */
const FRAMED_TYPES: readonly string[] = [CLASS_LABEL, PROPERTY_LABEL];

/** Returns the name a Class or Property record states. Throws where it doesn't state one, since the name is its id. */
function nameOf(record: Record<string, unknown>, persistedAs: string): string {
	const name = record[ONTOLOGY_FIELD.name];
	if (typeof name !== "string") throw new Error(`a ${persistedAs} record names its term by ${ONTOLOGY_FIELD.name}, and this one doesn't state it`);
	return name;
}

/** Throws for an edge, which a graph of one record doesn't draw. */
const withoutEdges = (type: string, edge: string): never => {
	throw new Error(`the frame of a ${type} record doesn't read its edge ${edge} as a drawn edge`);
};

/** Returns the frame that states a record of `persistedAs` itself, where its type is Class or Property; else undefined. */
export function recordFrame(persistedAs: string, { vertex, edges }: Pick<TIndividualWithEdges, "vertex" | "edges">): TRecordFrame | undefined {
	if (!FRAMED_TYPES.includes(persistedAs)) return undefined;
	const subject = nameOf(vertex, persistedAs);
	const ontology: TOntologyStatement[] = [
		...Object.entries(vertex)
			.filter(([, object]) => typeof object === "string")
			.map(([predicate, object]) => ({ subject, predicate, object })),
		...edges.filter(({ direction }) => direction === "out").map(({ type, target }) => ({ subject, predicate: type, object: nameOf(target, persistedAs) })),
	];
	const frame = frameStating(graphAxioms({ nodes: [{ id: subject, type: persistedAs, properties: {} }], edges: [] }, ontology, withoutEdges), subject);
	return frame === undefined ? undefined : { lines: frame.dl.split(BETWEEN_AXIOMS), manchester: frame.manchester };
}
