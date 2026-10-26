/**
 * Derives the ontology from the declarations as quads and as records. A Class is each persisted type and each class a
 * type names as its superclass, with its `subClassOf` edges. A Property is each link relation, with its `subPropertyOf`
 * edges and its `domain` and `range` edges to the classes it connects. A graph view draws the quads, and the store of
 * the ontology's records reads the records.
 */
import { Access, CLASS_LABEL, edgeRanges, edgeRel, isPersisted, LinkRelations, PROPERTY_LABEL, type TRegisteredDomain } from "../../domains/resources.js";
import type { TCluster, TClusteredQuads, TQuad } from "../../steps/domains/quad-types.js";
import { ONTOLOGY_FIELD } from "../domains/ontology.js";
import { recordsOfQuads, type THeldRecord } from "./read-records.js";

/** A term of a standard vocabulary that a type conforms to and doesn't model, with its IRI. */
export type TStandardTerm = { term: string; iri: string };

/** The time each quad and record of the ontology states. The ontology doesn't change while the declarations hold, so every term states one time. */
const ONTOLOGY_TS = 0;
const ONTOLOGY_GENERATED_AT = new Date(ONTOLOGY_TS).toISOString();

/** Returns a term and every term it reaches through an immediate-parents map. */
export function ancestorsWith(term: string, supers: Map<string, string[]>): Set<string> {
	const out = new Set<string>([term]);
	const stack = [term];
	while (stack.length) {
		const at = stack.pop();
		if (at === undefined) break;
		const parents = supers.get(at);
		if (parents !== undefined) for (const parent of parents) if (!out.has(parent)) out.add(parent), stack.push(parent);
	}
	return out;
}

/** Returns the immediate `subClassOf` and `subPropertyOf` parents of every term of a projected ontology. */
export function superMap(quads: readonly TQuad[]): Map<string, string[]> {
	const parents = quads.filter((q) => q.predicate === ONTOLOGY_FIELD.subClassOf || q.predicate === ONTOLOGY_FIELD.subPropertyOf);
	return new Map([...Map.groupBy(parents, (q) => q.subject)].map(([subject, held]) => [subject, held.map((q) => String(q.object))]));
}

/** Maps each PROV and SOSA class to the designation of its subclasses. `sosa:Observation` is a subclass of `prov:Activity`, so it precedes Activity. */
const CATEGORY_ANCHOR: Record<string, string> = { "prov:Agent": "agent", "sosa:Observation": "observation", "prov:Activity": "activity", "prov:Entity": "artifact" };
const CATEGORY_PRECEDENCE = ["agent", "observation", "activity", "artifact"] as const;

/** Returns a class's designation: the first PROV or SOSA class its ancestry reaches, or artifact. */
export function categoryOf(cls: string, supers: Map<string, string[]>): string {
	const reached = new Set<string>();
	for (const ancestor of ancestorsWith(cls, supers)) if (CATEGORY_ANCHOR[ancestor]) reached.add(CATEGORY_ANCHOR[ancestor]);
	return CATEGORY_PRECEDENCE.find((category) => reached.has(category)) ?? "artifact";
}

/** Returns the persisted types that declare a rel as an edge or a property, in registration order: the union that is the rel's domain.
 *  An abstract super-property and a rel the types don't use return an empty list. */
export function typesDeclaringRel(domains: Record<string, TRegisteredDomain>, rel: string): string[] {
	const labels: string[] = [];
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		const t = d.topology;
		const inEdges = (t.edges === undefined ? [] : Object.values(t.edges)).some((e) => (e.rel ?? "") === rel);
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

const quadOf = (subject: string, predicate: string, object: unknown, namedGraph: string, objectType?: string): TQuad => ({
	subject,
	predicate,
	object,
	namedGraph,
	timestamp: ONTOLOGY_TS,
	...(objectType ? { objectType } : {}),
});

/**
 * Returns the ontology as quads in two clusters, Class and Property. A Class quad set states each persisted type and
 * each superclass a type names, with `subClassOf` edges and the class's category. A Property quad set states each link
 * relation, with its IRI, `abstract` where it is abstract, its `subPropertyOf` edges, and `domain` and `range` edges to
 * the classes it connects. The relations alone give the property hierarchy where `domains` is empty.
 */
export function ontologyToQuads(domains: Record<string, TRegisteredDomain>): TClusteredQuads {
	const quads: TQuad[] = [];
	const classSubjects: string[] = [];
	const propSubjects: string[] = [];
	const classLabels: Record<string, string> = {};
	const propLabels: Record<string, string> = {};

	const addClass = (id: string): void => {
		if (classLabels[id] !== undefined) return;
		classLabels[id] = id;
		classSubjects.push(id);
		quads.push(quadOf(id, ONTOLOGY_FIELD.name, id, CLASS_LABEL));
	};
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		const t = d.topology;
		addClass(t.persistedAs);
		if (t.type) quads.push(quadOf(t.persistedAs, ONTOLOGY_FIELD.classIri, t.type, CLASS_LABEL));
		const supers = t.subClassOf === undefined ? [] : Array.isArray(t.subClassOf) ? t.subClassOf : [t.subClassOf];
		for (const s of supers) {
			addClass(s);
			quads.push(quadOf(t.persistedAs, ONTOLOGY_FIELD.subClassOf, s, CLASS_LABEL, CLASS_LABEL));
		}
	}

	const addProp = (rel: string): void => {
		if (propLabels[rel] !== undefined) return;
		propLabels[rel] = rel;
		propSubjects.push(rel);
		quads.push(quadOf(rel, ONTOLOGY_FIELD.name, rel, PROPERTY_LABEL));
	};
	for (const entry of Object.values(LinkRelations)) {
		const rel = entry.rel;
		addProp(rel);
		quads.push(quadOf(rel, ONTOLOGY_FIELD.uri, entry.uri, PROPERTY_LABEL));
		if ((entry as { abstract?: boolean }).abstract) quads.push(quadOf(rel, ONTOLOGY_FIELD.abstract, true, PROPERTY_LABEL));
		// The domain: an edge from the Property to each persisted type that declares it.
		for (const domain of typesDeclaringRel(domains, rel)) quads.push(quadOf(rel, ONTOLOGY_FIELD.domain, domain, PROPERTY_LABEL, CLASS_LABEL));
		const sp = (entry as { subPropertyOf?: string | string[] }).subPropertyOf;
		const parents = sp === undefined ? [] : Array.isArray(sp) ? sp : [sp];
		for (const p of parents) {
			addProp(p);
			quads.push(quadOf(rel, ONTOLOGY_FIELD.subPropertyOf, p, PROPERTY_LABEL, PROPERTY_LABEL));
		}
	}

	// The range: an edge from each edge's Property to each class in the edge's range.
	for (const d of Object.values(domains)) {
		if (!isPersisted(d.topology)) continue;
		for (const [edge, edgeDef] of d.topology.edges === undefined ? [] : Object.entries(d.topology.edges)) {
			const rel = edgeDef.rel ?? edgeRel(edge);
			if (!rel) continue;
			addProp(rel);
			for (const range of edgeRanges(edgeDef)) {
				addClass(range);
				quads.push(quadOf(rel, ONTOLOGY_FIELD.range, range, PROPERTY_LABEL, CLASS_LABEL));
			}
		}
	}

	const supers = superMap(quads);
	for (const cls of classSubjects) quads.push(quadOf(cls, ONTOLOGY_FIELD.category, categoryOf(cls, supers), CLASS_LABEL));

	return { quads, clusters: [cluster(CLASS_LABEL, classSubjects, classLabels), cluster(PROPERTY_LABEL, propSubjects, propLabels)] };
}

/**
 * Returns an ontology with each type's standard-vocabulary terms added as Property nodes that state `inData: false`.
 * A term already present as a Property is left as it is. Each added term has a `domain` edge to its type's Class, and a
 * type without a Class gains one.
 */
export function withStandardTerms(ontology: TClusteredQuads, standardVocab: ReadonlyMap<string, readonly TStandardTerm[]>): TClusteredQuads {
	const quads = [...ontology.quads];
	const clusters = ontology.clusters.map((c) => ({ ...c, sampledSubjects: [...c.sampledSubjects], displayLabels: { ...c.displayLabels } }));
	const propCluster = clusters.find((c) => c.type === PROPERTY_LABEL);
	const classCluster = clusters.find((c) => c.type === CLASS_LABEL);
	if (!propCluster || !classCluster) throw new Error(`an ontology holds a ${CLASS_LABEL} and a ${PROPERTY_LABEL} cluster, and this one doesn't`);
	const propSubjects = new Set(propCluster.sampledSubjects);
	const classSubjects = new Set(classCluster.sampledSubjects);
	const supers = superMap(quads);
	const ensureClass = (label: string): void => {
		if (classSubjects.has(label)) return;
		classSubjects.add(label);
		classCluster.sampledSubjects.push(label);
		classCluster.displayLabels[label] = label;
		quads.push(quadOf(label, ONTOLOGY_FIELD.name, label, CLASS_LABEL), quadOf(label, ONTOLOGY_FIELD.category, categoryOf(label, supers), CLASS_LABEL));
	};
	for (const [typeLabel, terms] of standardVocab) {
		for (const { term, iri } of terms) {
			if (propSubjects.has(term)) continue;
			propSubjects.add(term);
			propCluster.sampledSubjects.push(term);
			propCluster.displayLabels[term] = term;
			ensureClass(typeLabel);
			quads.push(
				quadOf(term, ONTOLOGY_FIELD.name, term, PROPERTY_LABEL),
				quadOf(term, ONTOLOGY_FIELD.uri, iri, PROPERTY_LABEL),
				quadOf(term, ONTOLOGY_FIELD.inData, false, PROPERTY_LABEL),
				quadOf(term, ONTOLOGY_FIELD.domain, typeLabel, PROPERTY_LABEL, CLASS_LABEL),
			);
		}
	}
	for (const c of [propCluster, classCluster]) c.totalCount = c.sampledCount = c.sampledSubjects.length;
	return { quads, clusters };
}

/** Returns the ontology's records: each Class and Property the quads state, with the time and the level every term states. */
export function ontologyRecords(ontology: TClusteredQuads): THeldRecord[] {
	return recordsOfQuads(ontology.quads).map((record) => ({
		...record,
		fields: { ...record.fields, [ONTOLOGY_FIELD.generatedAtTime]: ONTOLOGY_GENERATED_AT, [ONTOLOGY_FIELD.accessLevel]: Access.public },
		level: Access.public,
	}));
}
