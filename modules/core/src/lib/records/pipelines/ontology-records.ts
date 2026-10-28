/**
 * Reads the ontology's records: the Class and Property records core derives from the declarations. The records and the
 * read of the ontology's terms are derived once for each set of declarations, and a read of them takes the read's bound, count and order from
 * `readFromRecords`. A read of the ontology lists its terms as a counted list, which `show ontology` returns.
 */
import type { TClusteredQuads, TGraphQuery, TRecordsPage } from "../../steps/domains/quad-types.js";
import { ontologyRecords, ontologyToQuads, withStandardTerms } from "../derivations/ontology.js";
import { counted } from "../../domains/hypermedia.js";
import { CLASS_LABEL, PROPERTY_LABEL, type TRecordNamespace, type TRegisteredDomain } from "../../domains/resources.js";
import { concernCatalogOf } from "../../steps/pipelines/discover-steps.js";
import { ONTOLOGY_FIELD } from "../domains/ontology.js";
import { ONTOLOGY_TERM, type TOntologyRead } from "../domains/ontology-read.js";
import { readDeclarationsOf, readFromRecords, recordsOfQuads, type THeldRecord } from "../derivations/read-records.js";
import { classAxioms, propertyAxioms } from "../derivations/axioms.js";
import { enumerateStandardVocab, type TVocabularyWarning } from "./standard-vocabulary.js";
import type { TRecordReader } from "./record-reads.js";

/** What is derived from a set of declarations, and the count of those declarations: the ontology's records, and the read of
 *  its terms. */
type TDerived = { size: number; records: Promise<THeldRecord[]>; read: Promise<TOntologyRead> };
const derivedFor = new WeakMap<Record<string, TRegisteredDomain>, TDerived>();

/** Returns what the declarations derive: the ontology they state, each type's class and each link relation, with the terms of
 *  the standard vocabularies the types follow, as records and as a read of its terms. A declaration added since the last
 *  derivation derives them again. */
function derivedOf(domains: Record<string, TRegisteredDomain>, warn: TVocabularyWarning): TDerived {
	const size = Object.keys(domains).length;
	const held = derivedFor.get(domains);
	if (held && held.size === size) return held;
	const ontology = enumerateStandardVocab(domains, warn).then((standard) => withStandardTerms(ontologyToQuads(domains), standard));
	const derived = { size, records: ontology.then(ontologyRecords), read: ontology.then((stated) => readOntology(stated, domains)) };
	derivedFor.set(domains, derived);
	return derived;
}

/** Returns the ontology the declarations state as a read of it lists it: a counted list of its terms. */
export const ontologyRead = (domains: Record<string, TRegisteredDomain>, warn: TVocabularyWarning): Promise<TOntologyRead> => derivedOf(domains, warn).read;

/**
 * Returns the reader of the ontology's records over the current declarations. The declarations are served to every
 * reader as the `@context`, so a read returns the ontology's records at every level it states, each by its record IRI under
 * the records' namespace.
 */
export function ontologyReader(domains: () => Record<string, TRegisteredDomain>, records: () => TRecordNamespace, warn: TVocabularyWarning): TRecordReader {
	return {
		async readRecords({ accessLevel: _stated, ...everyLevel }: TGraphQuery): Promise<TRecordsPage> {
			const declared = domains();
			return readFromRecords(await derivedOf(declared, warn).records, everyLevel, readDeclarationsOf(declared, records()));
		},
	};
}

/** The names an edge of each record links, by the edge's relation. */
const linked = (record: THeldRecord, rel: string): string[] => record.edges.filter((edge) => edge.rel === rel).map(({ id }) => id);
const optionalText = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
/** Whether a Property's term is in the records' data, which the ontology states of every Property at derivation. */
function statedInData(property: string, value: unknown): boolean {
	if (typeof value !== "boolean")
		throw new Error(`the Property ${property} states inData as ${String(value)}, and the ontology states it as true or false of every Property. Derive it with ontologyToQuads.`);
	return value;
}

/**
 * Returns an ontology's terms as a counted list: each class, with each field and edge its type declares and the link
 * relation of each, and each property, with the classes it connects, as the ontology's quads state them, each with its axioms
 * in DL notation.
 */
function readOntology(ontology: TClusteredQuads, domains: Record<string, TRegisteredDomain>): TOntologyRead {
	const records = recordsOfQuads(ontology.quads);
	const { persisted } = concernCatalogOf(domains);
	const classes = records
		.filter(({ label }) => label === CLASS_LABEL)
		.map((record) => {
			const concern = persisted[record.id];
			const iri = optionalText(record.fields[ONTOLOGY_FIELD.classIri]);
			const subClassOf = linked(record, ONTOLOGY_FIELD.subClassOf);
			return {
				kind: ONTOLOGY_TERM.class,
				name: record.id,
				...(iri === undefined ? {} : { iri }),
				category: String(record.fields[ONTOLOGY_FIELD.category]),
				subClassOf,
				properties: concern === undefined ? {} : Object.fromEntries(Object.entries(concern.properties).map(([field, { rel }]) => [field, rel])),
				edges: concern === undefined ? {} : Object.fromEntries(Object.entries(concern.edges).map(([edge, { rel, targets }]) => [edge, { rel, range: targets }])),
				dl: classAxioms(record.id, [...(iri === undefined || iri === record.id ? [] : [iri]), ...subClassOf]).dl,
			};
		});
	const properties = records
		.filter(({ label }) => label === PROPERTY_LABEL)
		.map((record) => {
			const uri = optionalText(record.fields[ONTOLOGY_FIELD.uri]);
			const [subPropertyOf, domain, range] = [linked(record, ONTOLOGY_FIELD.subPropertyOf), linked(record, ONTOLOGY_FIELD.domain), linked(record, ONTOLOGY_FIELD.range)];
			return {
				kind: ONTOLOGY_TERM.property,
				name: record.id,
				...(uri === undefined ? {} : { uri }),
				abstract: record.fields[ONTOLOGY_FIELD.abstract] === true,
				inData: statedInData(record.id, record.fields[ONTOLOGY_FIELD.inData]),
				subPropertyOf,
				domain,
				range,
				dl: propertyAxioms(record.id, domain, range, subPropertyOf).dl,
			};
		});
	const terms = [...classes, ...properties];
	return { terms, ...counted(terms.length) };
}
