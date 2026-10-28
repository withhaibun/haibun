/**
 * Derives the ontology as OWL 2 in Turtle, the profile OWL 2 RL evaluates by rules. Each Class is an `owl:Class` under the
 * haibun namespace, and the JSON-LD `@type` IRI it declares is its superclass, since several classes declare one IRI. Each
 * Property is an `owl:ObjectProperty` where an edge reaches a class, and an `rdf:Property` otherwise. The classes that declare a
 * property are the union of its domain, and the classes its edges reach are the union of its range. Several `rdfs:domain`
 * axioms would state their intersection. Every CURIE expands through the prefixes of the served `@context`.
 */
import { DataFactory, Writer } from "n3";
import type { Quad_Object, NamedNode } from "@rdfjs/types";
import { itemAt } from "../../domains/item-at.js";
import { MEDIA_TYPE } from "../../domains/media-types.js";
import { NAMESPACE, OWL, RDF, RDFS } from "../../domains/vocabularies.js";
import { CLASS_LABEL, HAIBUN_PREFIX, PROPERTY_LABEL } from "../../domains/resources.js";
import type { TClusteredQuads, TQuad } from "../../steps/domains/quad-types.js";
import { ONTOLOGY_FIELD } from "../domains/ontology.js";

const CURIE = /^([A-Za-z][\w-]*):(?!\/\/)(.+)$/;
const ABSOLUTE_IRI = /^[a-z][a-z\d+.-]*:\/\//i;

/** Returns the IRI a term names: an absolute IRI as itself, a CURIE through the context's prefixes, and a bare name in the
 *  haibun namespace. Throws where a CURIE's prefix isn't bound in the context. */
export function iriIn(context: Record<string, unknown>, term: string): string {
	if (ABSOLUTE_IRI.test(term)) return term;
	const curie = CURIE.exec(term);
	const [prefix, local] = curie === null ? [HAIBUN_PREFIX, term] : [curie[1], curie[2]];
	const namespace = prefix === undefined ? undefined : context[prefix];
	if (typeof namespace !== "string") throw new Error(`the prefix ${prefix} of ${term} isn't bound in the served @context. Declare it in the type's \`namespaces\`.`);
	return `${namespace}${local}`;
}

/** Returns the ontology's axioms in Turtle, written by N3.js, with each term's IRI from the served context. */
export function ontologyOwl(ontology: TClusteredQuads, context: Record<string, unknown>): string {
	const { namedNode } = DataFactory;
	const writer = new Writer({ format: MEDIA_TYPE.turtle, prefixes: { owl: NAMESPACE.owl, rdf: NAMESPACE.rdf, rdfs: NAMESPACE.rdfs } });
	const ref = (term: string): NamedNode => namedNode(iriIn(context, term));
	const stated = (label: string, field: string): TQuad[] => ontology.quads.filter((q) => q.namedGraph === label && q.predicate === field);
	const objectsBySubject = (label: string, field: string): Map<string, string[]> =>
		new Map([...Map.groupBy(stated(label, field), (q) => q.subject)].map(([subject, held]) => [subject, held.map((q) => String(q.object))]));
	const propertyIri = new Map(stated(PROPERTY_LABEL, ONTOLOGY_FIELD.uri).map((q) => [q.subject, String(q.object)]));
	const property = (name: string): NamedNode => ref(propertyIri.get(name) ?? name);
	const unionOf = (classes: string[]): Quad_Object =>
		classes.length === 1
			? ref(itemAt(classes, 0))
			: writer.blank([
					{ predicate: namedNode(RDF.type), object: namedNode(OWL.Class) },
					// N3.js's writer returns a list it writes in place of an object; its typings state it as an array of objects.
					{ predicate: namedNode(OWL.unionOf), object: writer.list(classes.map(ref)) as unknown as Quad_Object },
				]);
	// Each axiom of named terms is written once, though several records state it.
	const written = new Set<string>();
	const axiom = (subject: NamedNode, predicate: string, object: Quad_Object): void => {
		const key = `${subject.value} ${predicate} ${"value" in object ? object.value : ""}`;
		if ("termType" in object && written.has(key)) return;
		written.add(key);
		writer.addQuad(subject, namedNode(predicate), object);
	};
	for (const { subject } of stated(CLASS_LABEL, ONTOLOGY_FIELD.name)) axiom(ref(subject), RDF.type, namedNode(OWL.Class));
	for (const field of [ONTOLOGY_FIELD.classIri, ONTOLOGY_FIELD.subClassOf])
		for (const { subject, object } of stated(CLASS_LABEL, field)) if (!ref(subject).equals(ref(String(object)))) axiom(ref(subject), RDFS.subClassOf, ref(String(object)));
	const [domains, ranges] = [objectsBySubject(PROPERTY_LABEL, ONTOLOGY_FIELD.domain), objectsBySubject(PROPERTY_LABEL, ONTOLOGY_FIELD.range)];
	for (const { subject } of stated(PROPERTY_LABEL, ONTOLOGY_FIELD.name)) {
		const [domain, range] = [domains.get(subject), ranges.get(subject)];
		axiom(property(subject), RDF.type, namedNode(range === undefined ? RDF.Property : OWL.ObjectProperty));
		if (domain !== undefined) axiom(property(subject), RDFS.domain, unionOf(domain));
		if (range !== undefined) axiom(property(subject), RDFS.range, unionOf(range));
	}
	for (const q of stated(PROPERTY_LABEL, ONTOLOGY_FIELD.subPropertyOf)) axiom(property(q.subject), RDFS.subPropertyOf, property(String(q.object)));
	let turtle: string | undefined;
	writer.end((error, result: string) => {
		if (error) throw error;
		turtle = result;
	});
	if (turtle === undefined) throw new Error("N3.js's writer ended without its text. Write the ontology's axioms again.");
	return turtle;
}
