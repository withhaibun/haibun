/**
 * Prepares the ontology for a graph view. Core derives the ontology from the declarations as two clusters of quads, Class
 * and Property (`ontologyToQuads`). This module prunes it to the terms the data uses, scopes it to one type, and adds it
 * to an instance graph's response with an `a` edge from each instance to its Class. A view draws the ontology as it draws
 * any other graph.
 */
import { CLASS_LABEL, HAIBUN_NS, HAIBUN_PREFIXES, PROPERTY_LABEL, type TRegisteredDomain } from "@haibun/core/lib/resources.js";
import type { TQuad, TClusteredQuads } from "@haibun/core/lib/quad-types.js";
import { ancestorsWith, ontologyToQuads, superMap, withStandardTerms, type TStandardTerm } from "@haibun/core/lib/records/derivations/ontology.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";

/** The edge from an individual to the class it is an instance of, named as JSON-LD's `@type` and Turtle's `a` name it. */
const INSTANCE_OF = "a";

/** The two types a schema's graph draws, Class and Property. */
export const SCHEMA_TYPES: readonly string[] = [CLASS_LABEL, PROPERTY_LABEL];

/** Whether a @type is one of the two schema clusters: the ONE predicate every schema-aware surface reuses: the filter
 *  (default-hide), the paint (distinct shape), and the layout (timeless, so pinned to the front z=0 plane, not the age axis). */
export const isSchemaType = (type: string): boolean => SCHEMA_TYPES.includes(type);

/** A property's provenance, keyed off its IRI. `haibun` when the term is haibun's own vocabulary: a CURIE under one of
 *  haibun's own prefixes, or an IRI under HAIBUN_NS. Otherwise the term belongs to a separate vocabulary (a standard, or a
 *  consumer's own) and is identified by that vocabulary's own prefix: this doesn't assume a closed set of
 *  non-haibun vocabularies. Lets a view mark haibun-added fields distinctly and group a type's properties by their vocabulary. */
export function propertyVocabulary(iri: string): { source: "haibun" | "standard"; prefix: string } {
	const colon = iri.indexOf(":");
	const curiePrefix = colon > 0 && !iri.startsWith("http") ? iri.slice(0, colon) : "";
	const isHaibun = curiePrefix ? (HAIBUN_PREFIXES as readonly string[]).includes(curiePrefix) : iri.startsWith(HAIBUN_NS);
	return { source: isHaibun ? "haibun" : "standard", prefix: isHaibun ? "haibun" : curiePrefix || "?" };
}

/** True when a property's IRI is haibun's own vocabulary (not a standard term). */
export const isHaibunTerm = (iri: string): boolean => propertyVocabulary(iri).source === "haibun";

/** Prune a projected ontology to the terms the data exercises, a Class with an instance, a Property in use, plus the
 *  ancestors of each used term (subClassOf/subPropertyOf: an abstract super like inRoleOf or prov:Agent IS the
 *  interesting structure, so a used leaf pulls in its whole hierarchy). getClusteredQuads calls this with the FULL
 *  observation set as evidence when it assembles its response, so the served schema and its cluster counts stay correct
 *  however the request narrowed its types: a schema-only fetch (Class + Property alone) still reflects what the whole
 *  data uses. Edges to a pruned term fall away on their own (buildGraphModelFromQuads needs both endpoints). */
export function pruneOntologyToUse(ontology: TClusteredQuads, evidence: TQuad[]): TClusteredQuads {
	const used = new Set<string>(); // instance types + used predicates
	for (const q of evidence) {
		if (isSchemaType(q.namedGraph)) continue;
		used.add(q.namedGraph); // an instance graph is named by its type
		used.add(q.predicate);
	}
	const supers = superMap(ontology.quads); // subClassOf / subPropertyOf: a schema term → its immediate parents
	const keep = new Set(used);
	for (const term of used) for (const a of ancestorsWith(term, supers)) keep.add(a);
	const quads = ontology.quads.filter((q) => keep.has(q.subject));
	const clusters = ontology.clusters.map((c) => {
		const subjects = c.sampledSubjects.filter((s) => keep.has(s));
		const displayLabels = Object.fromEntries(Object.entries(c.displayLabels).filter(([s]) => keep.has(s)));
		return { ...c, totalCount: subjects.length, sampledCount: subjects.length, sampledSubjects: subjects, displayLabels };
	});
	return { quads, clusters };
}

/** Scope schema quads to ONE type's own vocabulary: the type's Class, every schema term connected to it in either
 *  direction (its properties via their rdfs:domain edges, its superclass via subClassOf, any subclass pointing at it),
 *  and those kept terms' own scalar quads (name, uri, abstract) so they render labelled. Non-schema quads pass through
 *  untouched: instance visibility stays the type filter's concern. The class browser's single-type scope. */
/** The schema terms directly connected to `type` in either edge direction: the shared core of the type-scoped views. */
function keepConnectedToType(quads: TQuad[], type: string): Set<string> {
	const keep = new Set<string>([type]);
	for (const q of quads) {
		if (!isSchemaType(q.namedGraph)) continue;
		if (q.subject === type && q.objectType !== undefined) keep.add(String(q.object));
		if (q.object === type && q.objectType !== undefined) keep.add(q.subject);
	}
	return keep;
}

/** Keep the schema quads whose subject is in `keep`; instance quads pass through untouched. */
function filterSchemaTo(quads: TQuad[], keep: Set<string>): TQuad[] {
	return quads.filter((q) => (isSchemaType(q.namedGraph) ? keep.has(q.subject) : true));
}

export function scopeSchemaToType(quads: TQuad[], type: string): TQuad[] {
	return filterSchemaTo(quads, keepConnectedToType(quads, type));
}

/** The focus type plus its immediate connections: its own schema (properties, superclass) AND the types those properties
 *  range over: one hop out in type space, so a reader sees what the type relates to without the whole vocabulary. The
 *  connected types show as nodes without their own properties (their domain edges are left out). */
export function scopeSchemaToConnected(quads: TQuad[], type: string): TQuad[] {
	const keep = keepConnectedToType(quads, type);
	// The range types of the kept properties: the type's immediate connections in type space.
	for (const q of quads) {
		if (isSchemaType(q.namedGraph) && q.predicate === ONTOLOGY_FIELD.range && keep.has(q.subject) && q.objectType !== undefined) keep.add(String(q.object));
	}
	return filterSchemaTo(quads, keep);
}

/** Include the pruned ontology (the schema the `evidence` data exercises) in an instance-graph response, so one response
 *  carries both the data and the model that drives it: the two Class + Property clusters at t=0 (default-hidden on the
 *  client, revealed via their filter chip) plus one rdf:type (`a`) edge per instance to its Class: the edge lives in the
 *  instance's own graph so buildGraphModelFromQuads drops it until the Class chip is revealed, and it never inflates the
 *  Class count. The ONE assembler both the live getClusteredQuads and the offline report use, so a served report's
 *  schema view matches a live one. `evidence` is the full data (live: the observation buffer; offline: the serialized
 *  graph), never a type-narrowed subset: that keeps the pruning correct however the request scoped its types. */
export function withOntologySchema(
	response: TClusteredQuads,
	evidence: TQuad[],
	domains: Record<string, TRegisteredDomain>,
	standardVocab?: ReadonlyMap<string, readonly TStandardTerm[]>,
): TClusteredQuads {
	// The standard terms are added after the pruning. The data doesn't use them, so the pruning would remove them, and a type
	// view shows a standard's whole vocabulary. Each has a domain edge to its type, so scopeSchemaToType keeps it.
	const pruned = pruneOntologyToUse(ontologyToQuads(domains), evidence);
	const ontology = standardVocab ? withStandardTerms(pruned, standardVocab) : pruned;
	const classNodes = new Set(ontology.clusters.find((c) => c.type === CLASS_LABEL)?.sampledSubjects ?? []);
	const typeEdges: TQuad[] = [];
	const linkedSubjects = new Set<string>();
	for (const q of response.quads) {
		if (!classNodes.has(q.namedGraph) || linkedSubjects.has(q.subject)) continue;
		linkedSubjects.add(q.subject);
		typeEdges.push({
			subject: q.subject,
			predicate: INSTANCE_OF,
			object: q.namedGraph,
			objectType: CLASS_LABEL,
			namedGraph: q.namedGraph,
			timestamp: q.timestamp,
			properties: undefined,
		});
	}
	return { quads: [...response.quads, ...typeEdges, ...ontology.quads], clusters: [...response.clusters, ...ontology.clusters] };
}
