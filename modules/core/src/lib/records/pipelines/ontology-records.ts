/**
 * Reads the ontology's records: the Class and Property records core derives from the declarations. The records are
 * derived once for each set of declarations, and a read of them takes the read's bound, count and order from
 * `readFromRecords`.
 */
import type { TRegisteredDomain } from "../../resources.js";
import type { TGraphQuery, TRecordsPage } from "../../steps/domains/quad-types.js";
import { ontologyRecords, ontologyToQuads, withStandardTerms } from "../derivations/ontology.js";
import { readDeclarationsOf, readFromRecords, type THeldRecord } from "../derivations/read-records.js";
import { enumerateStandardVocab, type TVocabularyWarning } from "./standard-vocabulary.js";
import type { TRecordReader } from "./record-reads.js";

/** The records derived from a set of declarations, and the count of those declarations. */
type TDerived = { size: number; records: Promise<THeldRecord[]> };
const derivedFor = new WeakMap<Record<string, TRegisteredDomain>, TDerived>();

/** Returns the ontology's records for the declarations. A declaration added since the last derivation derives them again. */
function recordsOf(domains: Record<string, TRegisteredDomain>, warn: TVocabularyWarning): Promise<THeldRecord[]> {
	const size = Object.keys(domains).length;
	const held = derivedFor.get(domains);
	if (held && held.size === size) return held.records;
	const records = enumerateStandardVocab(domains, warn).then((vocab) => ontologyRecords(withStandardTerms(ontologyToQuads(domains), vocab)));
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
