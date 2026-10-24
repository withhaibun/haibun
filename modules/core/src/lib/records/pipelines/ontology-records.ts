/**
 * Reads the ontology's records: the Class and Property records core derives from the declarations. The records are
 * derived once for each set of declarations, and a read of them takes the read's bound, count and order from
 * `readFromRecords`. A read of the ontology lists its terms as a counted list, which `show ontology` returns.
 */
import type { TClusteredQuads, TGraphQuery, TRecordsPage } from "../../steps/domains/quad-types.js";
import { ontologyRecords, ontologyToQuads, withStandardTerms } from "../derivations/ontology.js";
import { counted, relOf } from "../../domains/hypermedia.js";
import { CLASS_LABEL, edgeRanges, edgeRel, isPersisted, PROPERTY_LABEL, type TRegisteredDomain } from "../../domains/resources.js";
import { ONTOLOGY_FIELD } from "../domains/ontology.js";
import { ONTOLOGY_TERM, type TOntologyRead } from "../domains/ontology-read.js";
import { readDeclarationsOf, readFromRecords, recordsOfQuads, type THeldRecord } from "../derivations/read-records.js";
import { enumerateStandardVocab, type TVocabularyWarning } from "./standard-vocabulary.js";
import type { TRecordReader } from "./record-reads.js";

/** The records derived from a set of declarations, and the count of those declarations. */
type TDerived = { size: number; records: Promise<THeldRecord[]> };
const derivedFor = new WeakMap<Record<string, TRegisteredDomain>, TDerived>();

/** Returns the ontology the declarations state: each type's class and each link relation, with the terms of the standard
 *  vocabularies the types follow. */
export const ontologyOf = async (domains: Record<string, TRegisteredDomain>, warn: TVocabularyWarning): Promise<TClusteredQuads> =>
	withStandardTerms(ontologyToQuads(domains), await enumerateStandardVocab(domains, warn));

/** Returns the ontology the declarations state as a read of it lists it: a counted list of its terms. */
export const ontologyRead = async (domains: Record<string, TRegisteredDomain>, warn: TVocabularyWarning): Promise<TOntologyRead> =>
	readOntology(await ontologyOf(domains, warn), domains);

/** Returns the ontology's records for the declarations. A declaration added since the last derivation derives them again. */
function recordsOf(domains: Record<string, TRegisteredDomain>, warn: TVocabularyWarning): Promise<THeldRecord[]> {
	const size = Object.keys(domains).length;
	const held = derivedFor.get(domains);
	if (held && held.size === size) return held.records;
	const records = ontologyOf(domains, warn).then(ontologyRecords);
	derivedFor.set(domains, { size, records });
	return records;
}

/**
 * Returns the reader of the ontology's records over the current declarations. The declarations are served to every
 * reader as the `@context`, so a read returns the ontology's records at every level it states.
 */
export function ontologyReader(domains: () => Record<string, TRegisteredDomain>, warn: TVocabularyWarning): TRecordReader {
	return {
		async readRecords({ accessLevel: _stated, ...everyLevel }: TGraphQuery): Promise<TRecordsPage> {
			const declared = domains();
			return readFromRecords(await recordsOf(declared, warn), everyLevel, readDeclarationsOf(declared));
		},
	};
}

/** The names an edge of each record links, by the edge's relation. */
const linked = (record: THeldRecord, rel: string): string[] => record.edges.filter((edge) => edge.rel === rel).map(({ id }) => id);
const optionalText = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Returns an ontology's terms as a counted list: each class, with each field and edge its type declares and the link
 * relation of each, and each property, with the classes it connects, as the ontology's quads state them.
 */
export function readOntology(ontology: TClusteredQuads, domains: Record<string, TRegisteredDomain>): TOntologyRead {
	const records = recordsOfQuads(ontology.quads);
	const topologies = new Map(Object.values(domains).flatMap(({ topology }) => (isPersisted(topology) ? [[topology.persistedAs, topology] as const] : [])));
	const classes = records
		.filter(({ label }) => label === CLASS_LABEL)
		.map((record) => {
			const topology = topologies.get(record.id);
			const iri = optionalText(record.fields[ONTOLOGY_FIELD.classIri]);
			return {
				kind: ONTOLOGY_TERM.class,
				name: record.id,
				...(iri === undefined ? {} : { iri }),
				category: String(record.fields[ONTOLOGY_FIELD.category]),
				subClassOf: linked(record, ONTOLOGY_FIELD.subClassOf),
				properties: topology === undefined ? {} : Object.fromEntries(Object.entries(topology.properties).map(([field, def]) => [field, relOf(def)])),
				edges:
					topology?.edges === undefined
						? {}
						: Object.fromEntries(Object.entries(topology.edges).map(([edge, def]) => [edge, { rel: def.rel ?? edgeRel(edge) ?? edge, range: edgeRanges(def) }])),
			};
		});
	const properties = records
		.filter(({ label }) => label === PROPERTY_LABEL)
		.map((record) => {
			const uri = optionalText(record.fields[ONTOLOGY_FIELD.uri]);
			return {
				kind: ONTOLOGY_TERM.property,
				name: record.id,
				...(uri === undefined ? {} : { uri }),
				abstract: record.fields[ONTOLOGY_FIELD.abstract] === true,
				inData: record.fields[ONTOLOGY_FIELD.inData] !== false,
				subPropertyOf: linked(record, ONTOLOGY_FIELD.subPropertyOf),
				domain: linked(record, ONTOLOGY_FIELD.domain),
				range: linked(record, ONTOLOGY_FIELD.range),
			};
		});
	const terms = [...classes, ...properties];
	return { terms, ...counted(terms.length) };
}
