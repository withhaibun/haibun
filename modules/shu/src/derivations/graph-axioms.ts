/**
 * The axioms of what a graph model shows, in DL notation: an individual frame for each record, with its type as its class and
 * each literal property and each edge to another record as a fact; a class frame for each type it shows, with its superclasses;
 * and a property frame for each property it shows, with the union of its domain and of its range. A frame names the record that
 * asserted it and states the record's line where the record is a step's. A node that stands for the records a sample leaves out
 * isn't a record, so it and its edges don't state a frame.
 */
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { FRAME_KIND, type TGraphAxioms, type TFrame } from "@haibun/core/lib/records/domains/axioms.js";
import { classAxioms, individualAxioms, propertyAxioms, type TIndividualFact } from "@haibun/core/lib/records/derivations/axioms.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { GraphEdge, GraphModel, GraphNode } from "../domains/graph-model.js";

const BETWEEN_FRAMES = "\n\n";

/** The haibun statement behind a record's frame: the line a step's record states, or the record by its type and id. */
const statementOf = (node: GraphNode): string => {
	const line = node.properties[SEQ_PATH_FIELD.stepText];
	return typeof line === "string" ? line : `${node.type} ${node.id}`;
};

/** A literal property's value. Throws for a value that isn't text, a number or a boolean, which a graph model doesn't copy. */
function literalValue(node: GraphNode, property: string, value: unknown): string | number | boolean {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	throw new Error(`the property ${property} of ${node.id} holds a ${typeof value}, and a graph model holds text, a number or a boolean for a property`);
}

/** Returns the axioms of a graph model, with the classes and properties the ontology's quads state for what it shows. An
 *  edge's property is the link relation its type declares for it, as `relOf` returns it. */
export function graphAxioms({ nodes, edges }: GraphModel, ontology: readonly TQuad[], relOf: (type: string, edge: string) => string): TGraphAxioms {
	const records = new Map(nodes.filter((node) => node.isCluster !== true).map((node) => [node.id, node]));
	const shownEdges = edges.filter((edge) => records.has(edge.from) && records.has(edge.to));
	const objectsOf = (subject: string, field: string): string[] => ontology.filter((q) => q.subject === subject && q.predicate === field).map((q) => String(q.object));
	const individuals = [...records.values()].map((node): TFrame => {
		const outgoing = shownEdges.filter((edge) => edge.from === node.id);
		const facts: TIndividualFact[] = [
			...Object.entries(node.properties).map(([property, value]) => ({ property, value: literalValue(node, property, value), individual: false })),
			...outgoing.map((edge) => ({ property: edge.predicate, value: edge.to, individual: true })),
		];
		return {
			name: `${FRAME_KIND.individual} ${node.id}`,
			kind: FRAME_KIND.individual,
			...individualAxioms(node.id, [node.type], facts),
			statement: statementOf(node),
			assertedBy: { persistedAs: node.type, id: node.id },
			nodes: [node.id],
			edges: outgoing.map(({ from, predicate, to }) => ({ from, label: predicate, to })),
		};
	});
	const types = [...new Set([...records.values()].map((node) => node.type))];
	const classes = types.map(
		(type): TFrame => ({
			name: `${FRAME_KIND.class} ${type}`,
			kind: FRAME_KIND.class,
			...classAxioms(type, [...objectsOf(type, ONTOLOGY_FIELD.classIri).filter((iri) => iri !== type), ...objectsOf(type, ONTOLOGY_FIELD.subClassOf)]),
			statement: `the type ${type}`,
			nodes: [...records.values()].filter((node) => node.type === type).map(({ id }) => id),
			edges: [],
		}),
	);
	const byRel = new Map<string, GraphEdge[]>();
	for (const edge of shownEdges) {
		const rel = relOf(edge.graph, edge.predicate);
		const held = byRel.get(rel);
		if (held === undefined) byRel.set(rel, [edge]);
		else held.push(edge);
	}
	const properties = [...byRel].map(
		([rel, held]): TFrame => ({
			name: `${FRAME_KIND.property} ${rel}`,
			kind: FRAME_KIND.property,
			...propertyAxioms(rel, objectsOf(rel, ONTOLOGY_FIELD.domain), objectsOf(rel, ONTOLOGY_FIELD.range), objectsOf(rel, ONTOLOGY_FIELD.subPropertyOf)),
			statement: `the link relation ${rel}`,
			nodes: [],
			edges: held.map(({ from, predicate, to }) => ({ from, label: predicate, to })),
		}),
	);
	const frames = [...classes, ...properties, ...individuals];
	return {
		text: frames.map(({ manchester }) => manchester).join(BETWEEN_FRAMES),
		summary: { classes: classes.length, properties: properties.length, individuals: individuals.length },
		frames,
	};
}
