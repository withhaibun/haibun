/**
 * The axioms of what a graph model shows, in DL notation: an individual frame for each record, with its type as its class and
 * each literal property and each edge to another record as a fact; a class frame for each type it shows, with its superclasses;
 * and a property frame for each property it shows, with the union of its domain and of its range. A frame names the record that
 * asserted it and states the record's line where the record is a step's. A node that stands for the records a sample leaves out
 * isn't a record, so it and its edges don't state a frame.
 */
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { CLASS_LABEL } from "@haibun/core/lib/domains/resources.js";
import { FRAME_KIND, type TGraphAxioms, type TFrame } from "@haibun/core/lib/records/domains/axioms.js";
import { classAxioms, individualAxioms, propertyAxioms, type TIndividualFact } from "@haibun/core/lib/records/derivations/axioms.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { GraphEdge, GraphModel, GraphNode } from "../domains/graph-model.js";
import { INSTANCE_OF } from "./ontology-projection.js";

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
	// A record's edge to its Class states the class assertion its individual frame states from its type, so it isn't a property.
	const shownEdges = edges.filter((edge) => records.has(edge.from) && records.has(edge.to) && edge.predicate !== INSTANCE_OF);
	const objectsOf = (subject: string, field: string): string[] => ontology.filter((q) => q.subject === subject && q.predicate === field).map((q) => String(q.object));
	const superclassesOf = (type: string): string[] => [...objectsOf(type, ONTOLOGY_FIELD.classIri).filter((iri) => iri !== type), ...objectsOf(type, ONTOLOGY_FIELD.subClassOf)];
	/** A type's superclasses and theirs: the types the ontology entails an individual of the type holds. */
	const entailedOf = (type: string): string[] => {
		const held = new Set<string>();
		const visit = (from: string): void => {
			for (const superclass of superclassesOf(from)) if (!held.has(superclass) && superclass !== type) held.add(superclass), visit(superclass);
		};
		visit(type);
		return [...held];
	};
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
			entailed: entailedOf(node.type),
			statement: statementOf(node),
			assertedBy: { persistedAs: node.type, id: node.id },
			nodes: [node.id],
			edges: outgoing.map(({ from, predicate, to }) => ({ from, label: predicate, to })),
		};
	});
	const types = new Set([...records.values()].map((node) => node.type));
	// A Class record is a class as well as an individual of Class: its node carries the class's own axioms beside its type's records.
	const isClassRecord = (node: GraphNode, name: string): boolean => node.type === CLASS_LABEL && node.id === name;
	const classNames = [...new Set([...types, ...[...records.values()].filter((node) => node.type === CLASS_LABEL).map(({ id }) => id)])];
	const classes = classNames.map(
		(name): TFrame => ({
			name: `${FRAME_KIND.class} ${name}`,
			kind: FRAME_KIND.class,
			...classAxioms(name, superclassesOf(name)),
			statement: types.has(name) ? `the type ${name}` : `the class ${name}`,
			nodes: [...records.values()].filter((node) => node.type === name || isClassRecord(node, name)).map(({ id }) => id),
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
