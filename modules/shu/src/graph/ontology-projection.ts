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
/** The ontology is timeless — a fixed timestamp so the time axis / cursor treat every term as one age. */
const ONTOLOGY_TS = 0;

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
		quads.push({ subject: id, predicate: "name", object: id, namedGraph: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
	};
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		const t = d.topology;
		addClass(t.persistedAs);
		if (t.type) quads.push({ subject: t.persistedAs, predicate: "classIri", object: t.type, namedGraph: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
		const supers = t.subClassOf === undefined ? [] : Array.isArray(t.subClassOf) ? t.subClassOf : [t.subClassOf];
		for (const s of supers) {
			addClass(s);
			quads.push({ subject: t.persistedAs, predicate: "subClassOf", object: s, namedGraph: ONTOLOGY_CLASS, objectType: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
		}
	}

	const addProp = (rel: string): void => {
		if (propLabels[rel] !== undefined) return;
		propLabels[rel] = rel;
		propSubjects.push(rel);
		quads.push({ subject: rel, predicate: "name", object: rel, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS });
	};
	for (const entry of Object.values(LinkRelations)) {
		const rel = entry.rel;
		addProp(rel);
		quads.push({ subject: rel, predicate: "uri", object: entry.uri, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS });
		if ((entry as { abstract?: boolean }).abstract) quads.push({ subject: rel, predicate: "abstract", object: true, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS });
		const sp = (entry as { subPropertyOf?: string | string[] }).subPropertyOf;
		const parents = sp === undefined ? [] : Array.isArray(sp) ? sp : [sp];
		for (const p of parents) {
			addProp(p);
			quads.push({ subject: rel, predicate: "subPropertyOf", object: p, namedGraph: ONTOLOGY_PROPERTY, objectType: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS });
		}
	}

	return { quads, clusters: [cluster(ONTOLOGY_CLASS, classSubjects, classLabels), cluster(ONTOLOGY_PROPERTY, propSubjects, propLabels)] };
}
