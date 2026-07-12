/**
 * Project the ONTOLOGY (the schema / T-Box) as quads, so the same graph view that renders the instance data (the A-Box)
 * renders the model that drives it — no separate visualization engine. The ontology is already RDFS/OWL triples:
 * `sec:Issuer rdfs:subClassOf prov:Agent`, `issuer rdfs:subPropertyOf fromActor rdfs:subPropertyOf inRoleOf`. We emit
 * them as the same TQuad shape the store emits for individuals, so buildGraphModelFromQuads / the fisheye treat the
 * ontology as just another graph: two clusters — Class and Property — with the subClassOf / subPropertyOf hierarchies as
 * edges. Pure + GPU-free (unit-tested). Reusable: any consumer that has the registered domains + LinkRelations can show
 * its own ontology; nothing here is spopg- or credential-specific.
 */
import { LinkRelations, isPersisted, edgeRel, HAIBUN_NS, HAIBUN_PREFIXES, type TRegisteredDomain } from "@haibun/core/lib/resources.js";
import type { TQuad, TCluster, TClusteredQuads } from "@haibun/core/lib/quad-types.js";
import type { TStandardTerm } from "./standard-vocabulary.js";

/** The two ontology clusters (the fisheye shows each as its own container, coloured by type). */
export const ONTOLOGY_CLASS = "Class";
export const ONTOLOGY_PROPERTY = "Property";
/** Whether a @type is one of the two schema clusters — the ONE predicate every schema-aware surface reuses: the filter
 *  (default-hide), the paint (distinct shape), and the layout (timeless, so pinned to the front z=0 plane, not the age axis). */
export const isSchemaType = (type: string): boolean => type === ONTOLOGY_CLASS || type === ONTOLOGY_PROPERTY;

/** A property's provenance, keyed off its IRI. `haibun` when the term is haibun's own vocabulary — a CURIE under one of
 *  haibun's own prefixes, or an IRI under HAIBUN_NS. Otherwise the term belongs to a separate vocabulary (a standard, or a
 *  consumer's own) and is identified by that vocabulary's own prefix — no closed assumption about which non-haibun
 *  vocabularies exist. Lets a view mark haibun-added fields distinctly and group a type's properties by their vocabulary. */
export function propertyVocabulary(iri: string): { source: "haibun" | "standard"; prefix: string } {
	const colon = iri.indexOf(":");
	const curiePrefix = colon > 0 && !iri.startsWith("http") ? iri.slice(0, colon) : "";
	const isHaibun = curiePrefix ? (HAIBUN_PREFIXES as readonly string[]).includes(curiePrefix) : iri.startsWith(HAIBUN_NS);
	return { source: isHaibun ? "haibun" : "standard", prefix: isHaibun ? "haibun" : curiePrefix || "?" };
}

/** True when a property's IRI is haibun's own vocabulary (not a standard term). */
export const isHaibunTerm = (iri: string): boolean => propertyVocabulary(iri).source === "haibun";
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
	/** rdfs:range — the class an edge points at. With `domain` (the source classes) it makes the ontology fully
	 *  navigable: a Property links the classes it connects, so the whole schema reads as "class —property→ class". */
	range: "range",
	/** Whether a property is exercised by the type's data. Stamped `false` on a term a declared standard vocabulary defines
	 *  but the type does not model (declared-not-present), so a view can render it distinctly from a property in the data. */
	inData: "inData",
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

	// rdfs:range — each edge's declared target class, a drawn Property→Class edge (objectType Class). Together with `domain`
	// the ontology is fully connected: every relation shows the classes it links, so the whole schema can be viewed.
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		for (const [edge, edgeDef] of Object.entries(d.topology.edges ?? {})) {
			const rel = edgeDef.rel ?? edgeRel(edge);
			if (!rel || !edgeDef.range) continue;
			addProp(rel);
			addClass(edgeDef.range);
			quads.push({ subject: rel, predicate: ONTOLOGY_PRED.range, object: edgeDef.range, namedGraph: ONTOLOGY_PROPERTY, objectType: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
		}
	}

	return { quads, clusters: [cluster(ONTOLOGY_CLASS, classSubjects, classLabels), cluster(ONTOLOGY_PROPERTY, propSubjects, propLabels)] };
}

/** Prune a projected ontology to the terms the data exercises — a Class with an instance, a Property in use — plus the
 *  ancestors of each used term (subClassOf/subPropertyOf: an abstract super like inRoleOf or prov:Agent IS the
 *  interesting structure, so a used leaf pulls in its whole hierarchy). getClusteredQuads calls this with the FULL
 *  observation set as evidence when it assembles its response, so the served schema and its cluster counts stay correct
 *  however the request narrowed its types — a schema-only fetch (Class + Property alone) still reflects what the whole
 *  data uses. Edges to a pruned term fall away on their own (buildGraphModelFromQuads needs both endpoints). */
export function pruneOntologyToUse(ontology: TClusteredQuads, evidence: TQuad[]): TClusteredQuads {
	const used = new Set<string>(); // instance types + used predicates
	for (const q of evidence) {
		if (isSchemaType(q.namedGraph)) continue;
		used.add(q.namedGraph); // an instance graph is named by its type
		used.add(q.predicate);
	}
	const supers = new Map<string, string[]>(); // subClassOf / subPropertyOf: a schema term → its immediate parents
	for (const q of ontology.quads) {
		if (q.predicate === ONTOLOGY_PRED.subClassOf || q.predicate === ONTOLOGY_PRED.subPropertyOf) supers.set(q.subject, [...(supers.get(q.subject) ?? []), String(q.object)]);
	}
	const keep = new Set(used);
	const climb = (term: string): void => {
		for (const p of supers.get(term) ?? [])
			if (!keep.has(p)) {
				keep.add(p);
				climb(p);
			}
	};
	for (const term of used) climb(term);
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
 *  untouched — instance visibility stays the type filter's concern. The class browser's single-type scope. */
export function scopeSchemaToType(quads: TQuad[], type: string): TQuad[] {
	const keep = new Set<string>([type]);
	for (const q of quads) {
		if (!isSchemaType(q.namedGraph)) continue;
		if (q.subject === type && q.objectType !== undefined) keep.add(String(q.object));
		if (q.object === type && q.objectType !== undefined) keep.add(q.subject);
	}
	return quads.filter((q) => (isSchemaType(q.namedGraph) ? keep.has(q.subject) : true));
}

/** Include the pruned ontology (the schema the `evidence` data exercises) in an instance-graph response, so one response
 *  carries both the data and the model that drives it: the two Class + Property clusters at t=0 (default-hidden on the
 *  client, revealed via their filter chip) plus one rdf:type (`a`) edge per instance to its Class — the edge lives in the
 *  instance's own graph so buildGraphModelFromQuads drops it until the Class chip is revealed, and it never inflates the
 *  Class count. The ONE assembler both the live getClusteredQuads and the offline report use, so a served report's
 *  schema view matches a live one. `evidence` is the full data (live: the observation buffer; offline: the serialized
 *  graph), never a type-narrowed subset — that keeps the pruning correct however the request scoped its types. */
export function withOntologySchema(
	response: TClusteredQuads,
	evidence: TQuad[],
	domains: Record<string, TRegisteredDomain>,
	standardVocab?: Map<string, TStandardTerm[]>,
): TClusteredQuads {
	const ontology = pruneOntologyToUse(ontologyToQuads(domains), evidence);
	// Fold in each type's declared standard vocabulary AFTER pruning — these terms are declared-not-present (no instance
	// uses them), so the evidence-only prune would drop them; they must survive so a type view shows a standard's whole
	// vocabulary. Each carries an rdfs:domain edge to its type so scopeSchemaToType keeps it for the viewed type.
	if (standardVocab) injectStandardVocab(ontology, standardVocab);
	const classNodes = new Set(ontology.clusters.find((c) => c.type === ONTOLOGY_CLASS)?.sampledSubjects ?? []);
	const typeEdges: TQuad[] = [];
	const linkedSubjects = new Set<string>();
	for (const q of response.quads) {
		if (!classNodes.has(q.namedGraph) || linkedSubjects.has(q.subject)) continue;
		linkedSubjects.add(q.subject);
		typeEdges.push({ subject: q.subject, predicate: "a", object: q.namedGraph, objectType: ONTOLOGY_CLASS, namedGraph: q.namedGraph, timestamp: q.timestamp, properties: undefined });
	}
	return { quads: [...response.quads, ...typeEdges, ...ontology.quads], clusters: [...response.clusters, ...ontology.clusters] };
}

/** Add each type's declared standard-vocabulary terms to the (already-pruned) ontology as Property nodes — but only the
 *  terms NOT already present as a haibun rel (compared by IRI local name, so cred:issuer and the full VC issuer IRI are
 *  one term). Each injected term is stamped inData=false and given an rdfs:domain edge to its type's Class (added if the
 *  type has no instances), so it renders attached to the type and survives scopeSchemaToType. */
function injectStandardVocab(ontology: TClusteredQuads, standardVocab: Map<string, TStandardTerm[]>): void {
	const propCluster = ontology.clusters.find((c) => c.type === ONTOLOGY_PROPERTY);
	const classCluster = ontology.clusters.find((c) => c.type === ONTOLOGY_CLASS);
	if (!propCluster || !classCluster) return;
	const propSubjects = new Set(propCluster.sampledSubjects);
	const classSubjects = new Set(classCluster.sampledSubjects);
	const ensureClass = (label: string): void => {
		if (classSubjects.has(label)) return;
		classSubjects.add(label);
		classCluster.sampledSubjects.push(label);
		classCluster.displayLabels[label] = label;
		ontology.quads.push({ subject: label, predicate: ONTOLOGY_PRED.name, object: label, namedGraph: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS });
	};
	// The terms are already the declared-not-present set (enumerateStandardVocab deduped by name against the type's own
	// fields), so no dedup here — only skip a name that is already an ontology Property node (a global rel), then attach
	// each to its type via an rdfs:domain edge.
	for (const [typeLabel, terms] of standardVocab) {
		for (const { term, iri } of terms) {
			if (propSubjects.has(term)) continue;
			propSubjects.add(term);
			propCluster.sampledSubjects.push(term);
			propCluster.displayLabels[term] = term;
			ensureClass(typeLabel);
			ontology.quads.push(
				{ subject: term, predicate: ONTOLOGY_PRED.name, object: term, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS },
				{ subject: term, predicate: ONTOLOGY_PRED.uri, object: iri, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS },
				{ subject: term, predicate: ONTOLOGY_PRED.inData, object: false, namedGraph: ONTOLOGY_PROPERTY, timestamp: ONTOLOGY_TS },
				{ subject: term, predicate: ONTOLOGY_PRED.domain, object: typeLabel, namedGraph: ONTOLOGY_PROPERTY, objectType: ONTOLOGY_CLASS, timestamp: ONTOLOGY_TS },
			);
		}
	}
	propCluster.totalCount = propCluster.sampledCount = propCluster.sampledSubjects.length;
	classCluster.totalCount = classCluster.sampledCount = classCluster.sampledSubjects.length;
}
