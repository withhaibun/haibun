/**
 * Derives the ontology as OWL 2 in Turtle, the profile OWL 2 RL evaluates by rules. Each Class is an `owl:Class` under the
 * haibun namespace, and the JSON-LD `@type` IRI it declares is its superclass, since several classes declare one IRI. Each
 * Property is an `owl:ObjectProperty` where an edge reaches a class, and an `rdf:Property` otherwise. The classes that declare a
 * property are the union of its domain, and the classes its edges reach are the union of its range. Several `rdfs:domain`
 * axioms would state their intersection. Every CURIE expands through the prefixes of the served `@context`.
 */
import { itemAt } from "../../domains/item-at.js";
import { CLASS_LABEL, PROPERTY_LABEL } from "../../domains/resources.js";
import type { TClusteredQuads, TQuad } from "../../steps/domains/quad-types.js";
import { ONTOLOGY_FIELD } from "../domains/ontology.js";

/** The prefixes of the Turtle text. Each axiom names its terms by full IRI. */
const OWL_PREFIXES = [
	"@prefix owl: <http://www.w3.org/2002/07/owl#> .",
	"@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
	"@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
];
const CURIE = /^([A-Za-z][\w-]*):(?!\/\/)(.+)$/;
const ABSOLUTE_IRI = /^[a-z][a-z\d+.-]*:\/\//i;
/** The prefix of the haibun namespace in the served `@context`. A class without a prefix is a term of that namespace. */
const HAIBUN_PREFIX = "hbn";

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

/** Returns the ontology's axioms in Turtle, with each term's IRI from the served context. */
export function ontologyOwl(ontology: TClusteredQuads, context: Record<string, unknown>): string {
	const ref = (term: string): string => `<${iriIn(context, term)}>`;
	const stated = (label: string, field: string): TQuad[] => ontology.quads.filter((q) => q.namedGraph === label && q.predicate === field);
	const objectsBySubject = (label: string, field: string): Map<string, string[]> =>
		new Map([...Map.groupBy(stated(label, field), (q) => q.subject)].map(([subject, held]) => [subject, held.map((q) => String(q.object))]));
	const propertyIri = new Map(stated(PROPERTY_LABEL, ONTOLOGY_FIELD.uri).map((q) => [q.subject, String(q.object)]));
	const property = (name: string): string => ref(propertyIri.get(name) ?? name);
	const unionOf = (classes: string[]): string => (classes.length === 1 ? ref(itemAt(classes, 0)) : `[ a owl:Class ; owl:unionOf ( ${classes.map(ref).join(" ")} ) ]`);
	const superclasses = (field: string): string[] =>
		stated(CLASS_LABEL, field).flatMap(({ subject, object }) => (ref(subject) === ref(String(object)) ? [] : [`${ref(subject)} rdfs:subClassOf ${ref(String(object))} .`]));
	const [domains, ranges] = [objectsBySubject(PROPERTY_LABEL, ONTOLOGY_FIELD.domain), objectsBySubject(PROPERTY_LABEL, ONTOLOGY_FIELD.range)];
	const properties = stated(PROPERTY_LABEL, ONTOLOGY_FIELD.name).flatMap(({ subject }) => {
		const [domain, range] = [domains.get(subject), ranges.get(subject)];
		return [
			`${property(subject)} a ${range === undefined ? "rdf:Property" : "owl:ObjectProperty"} .`,
			...(domain === undefined ? [] : [`${property(subject)} rdfs:domain ${unionOf(domain)} .`]),
			...(range === undefined ? [] : [`${property(subject)} rdfs:range ${unionOf(range)} .`]),
		];
	});
	const subProperties = stated(PROPERTY_LABEL, ONTOLOGY_FIELD.subPropertyOf).map((q) => `${property(q.subject)} rdfs:subPropertyOf ${property(String(q.object))} .`);
	const classes = stated(CLASS_LABEL, ONTOLOGY_FIELD.name).map(({ subject }) => `${ref(subject)} a owl:Class .`);
	const axioms = [...classes, ...superclasses(ONTOLOGY_FIELD.classIri), ...superclasses(ONTOLOGY_FIELD.subClassOf), ...properties, ...subProperties];
	return `${[...OWL_PREFIXES, ...new Set(axioms)].join("\n")}\n`;
}

/** Returns the IRI of a record: the IRI of its type's class, a slash and its id. */
export const individualIri = (classIri: string, id: string): string => `${classIri}/${encodeURIComponent(id)}`;
