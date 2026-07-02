/**
 * Project the ONTOLOGY (the schema / T-Box) as quads, so the same graph view that renders the instance data (the A-Box)
 * renders the model that drives it — no separate visualization engine. The ontology is already RDFS/OWL triples:
 * `sec:Issuer rdfs:subClassOf prov:Agent`, `issuer rdfs:subPropertyOf fromActor rdfs:subPropertyOf inRoleOf`. We emit
 * them as the same TQuad shape the store emits for individuals, so buildGraphModelFromQuads / the fisheye treat the
 * ontology as just another graph: two clusters — Class and Property — with the subClassOf / subPropertyOf hierarchies as
 * edges. Pure + GPU-free (unit-tested). Reusable: any consumer that has the registered domains + LinkRelations can show
 * its own ontology; nothing here is spopg- or credential-specific.
 */
import { LinkRelations, isPersisted, type TRegisteredDomain } from "@haibun/core/lib/resources.js";
import type { TQuad, TCluster, TClusteredQuads } from "@haibun/core/lib/quad-types.js";

/** The two ontology clusters (the fisheye shows each as its own container, coloured by type). */
export const ONTOLOGY_CLASS = "Class";
export const ONTOLOGY_PROPERTY = "Property";
/** Whether a @type is one of the two folded schema clusters — the ONE predicate reused across the fold: the filter
 *  (default-hide), the paint (distinct shape), and the layout (timeless, so pinned to the front z=0 plane, not the age axis). */
export const isSchemaType = (type: string): boolean => type === ONTOLOGY_CLASS || type === ONTOLOGY_PROPERTY;
/** The predicates the projection emits — ONE source so the projector (writer) and the fisheye (reader of `domain`)
 *  never drift on a string. `domain` is the genuine rdfs:domain term and the only one read outside this module (the
 *  Property routing); it shares the bare-local-name convention of subClassOf / subPropertyOf. */
export const ONTOLOGY_PRED = {
	name: "name",
	uri: "uri",
	abstract: "abstract",
	classIri: "classIri",
	subClassOf: "subClassOf",
	subPropertyOf: "subPropertyOf",
	domain: "domain",
} as const;
/** The ontology is timeless — a fixed timestamp so the time axis / cursor treat every term as one age. */
const ONTOLOGY_TS = 0;

/** The rdfs:domain of a rel — the persisted type labels that declare it (as an edge or a property), in registration
 *  order. Empty for an abstract super-property (inRoleOf/fromActor/toActor) or a rel no registered type uses. Lets a
 *  click on a Property node open the windowed instances of a type that actually carries it. */
export function typesDeclaringRel(domains: Record<string, TRegisteredDomain>, rel: string): string[] {
	const labels: string[] = [];
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		const t = d.topology;
		const inEdges = Object.values(t.edges ?? {}).some((e) => (e.rel ?? "") === rel);
		const inProps = Object.values(t.properties).some((p) => (typeof p === "string" ? p : p.rel) === rel);
		if (inEdges || inProps) labels.push(t.persistedAs);
	}
	return labels;
}

const cluster = (type: string, subjects: string[], displayLabels: Record<string, string>): TCluster => ({
	type,
	totalCount: subjects.length,
	sampledCount: subjects.length,
	omittedCount: 0,
	sampledSubjects: subjects,
	displayLabels,
});

/**
 * Build the ontology graph: a Class node per persisted type plus the superclasses it `subClassOf` (e.g. Principal →
 * prov:Agent), and a Property node per LinkRelations rel with its `subPropertyOf` hierarchy (issuer → fromActor →
 * inRoleOf). Abstract super-properties (inRoleOf/fromActor/toActor) ARE shown — they are the interesting structure. The
 * `domains` give the classes; LinkRelations gives the properties, so the relation hierarchy renders even with no domains.
 */
export function ontologyToQuads(domains: Record<string, TRegisteredDomain> = {}): TClusteredQuads {
	const quads: TQuad[] = [];
	const classSubjects: string[] = [];
	const propSubjects: string[] = [];
	const classLabels: Record<string, string> = {};
	const propLabels: Record<string, string> = {};

	const addClass = (id: string): void => {
		if (classLabels[id] !== undefined) return;
		classLabels[id] = id;
		classSubjects.push(id);
		quads.push({ subject: id, predicate: ONTOLOGY_PRED.name, object: id, namedGraph: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
	};
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		const t = d.topology;
		addClass(t.persistedAs);
		if (t.type) quads.push({ subject: t.persistedAs, predicate: ONTOLOGY_PRED.classIri, object: t.type, namedGraph: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
		const supers = t.subClassOf === undefined ? [] : Array.isArray(t.subClassOf) ? t.subClassOf : [t.subClassOf];
		for (const s of supers) {
			addClass(s);
			quads.push({ subject: t.persistedAs, predicate: ONTOLOGY_PRED.subClassOf, object: s, namedGraph: ONTOLOGY_CLASS, objectType: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
		}
	}

	const addProp = (rel: string): void => {
		if (propLabels[rel] !== undefined) return;
		propLabels[rel] = rel;
		propSubjects.push(rel);
		quads.push({ subject: rel, predicate: ONTOLOGY_PRED.name, object: rel, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS });
	};
	for (const entry of Object.values(LinkRelations)) {
		const rel = entry.rel;
		addProp(rel);
		quads.push({ subject: rel, predicate: ONTOLOGY_PRED.uri, object: entry.uri, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS });
		if ((entry as { abstract?: boolean }).abstract)
			quads.push({ subject: rel, predicate: ONTOLOGY_PRED.abstract, object: true, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS });
		// rdfs:domain — the persisted types that declare this rel, each a drawn Property→Class edge (objectType Class): the
		// schema's structure, a Property pointing at the classes that carry it. The first also routes a click on the
		// Property to that type's windowed instances.
		for (const domain of typesDeclaringRel(domains, rel))
			quads.push({ subject: rel, predicate: ONTOLOGY_PRED.domain, object: domain, namedGraph: ONTOLOGY_PROPERTY, objectType: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
		const sp = (entry as { subPropertyOf?: string | string[] }).subPropertyOf;
		const parents = sp === undefined ? [] : Array.isArray(sp) ? sp : [sp];
		for (const p of parents) {
			addProp(p);
			quads.push({ subject: rel, predicate: ONTOLOGY_PRED.subPropertyOf, object: p, namedGraph: ONTOLOGY_PROPERTY, objectType: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS });
		}
	}

	return { quads, clusters: [cluster(ONTOLOGY_CLASS, classSubjects, classLabels), cluster(ONTOLOGY_PROPERTY, propSubjects, propLabels)] };
}

/** Drop the folded schema's UNIMPLEMENTED terms — a Class with no instance, a Property never used — so a revealed schema
 *  shows only the part of the vocabulary the data actually exercises, not all 100+ terms. An instance graph is named by
 *  its type, so a Class is used iff some graph carries its name, a Property iff a data quad uses its predicate. Edges to a
 *  dropped term fall away on their own (buildGraphModelFromQuads needs both endpoints). A no-op when no schema is present. */
export function dropUnusedSchema(quads: TQuad[]): TQuad[] {
	const used = new Set<string>(); // instance types + used predicates
	const supers = new Map<string, string[]>(); // subClassOf / subPropertyOf: a schema term → its immediate parents
	for (const q of quads) {
		if (isSchemaType(q.namedGraph)) {
			if (q.predicate === ONTOLOGY_PRED.subClassOf || q.predicate === ONTOLOGY_PRED.subPropertyOf) supers.set(q.subject, [...(supers.get(q.subject) ?? []), String(q.object)]);
			continue;
		}
		used.add(q.namedGraph); // an instance graph is named by its type
		used.add(q.predicate);
	}
	// Keep the ancestors of every used term too: an abstract super-class / super-property (inRoleOf, prov:Agent) IS the
	// interesting structure, so a used leaf pulls in its whole hierarchy even though nothing instantiates the parents.
	const keep = new Set(used);
	const climb = (term: string): void => {
		for (const p of supers.get(term) ?? [])
			if (!keep.has(p)) {
				keep.add(p);
				climb(p);
			}
	};
	for (const term of used) climb(term);
	return quads.filter((q) => (isSchemaType(q.namedGraph) ? keep.has(q.subject) : true));
}
