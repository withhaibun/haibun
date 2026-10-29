/**
 * Reads the records core derives from the declarations: the ontology's Class and Property records, and a Domain record for each
 * registered domain. The records are derived once for each set of declarations, and a read of them takes the read's bound, count
 * and order from `readFromRecords`.
 */
import type { TGraphQuery, TRecordsPage } from "../../steps/domains/quad-types.js";
import { ontologyRecords, ontologyToQuads, withStandardTerms } from "../derivations/ontology.js";
import type { TRecordNamespace, TRegisteredDomain } from "../../domains/resources.js";
import { readDeclarationsOf, readFromRecords, type THeldRecord } from "../derivations/read-records.js";
import { domainRecords } from "../derivations/domain-records.js";
import { enumerateStandardVocab, type TVocabularyWarning } from "./standard-vocabulary.js";
import type { TRecordReader } from "./record-reads.js";

/** The records a set of declarations derives, and the count of those declarations. */
type TDerived = { size: number; records: Promise<THeldRecord[]> };
const derivedFor = new WeakMap<Record<string, TRegisteredDomain>, TDerived>();

/** Returns the records the declarations derive: the ontology they state, each type's class and each link relation, with the
 *  terms of the standard vocabularies the types follow, and each registered domain. A declaration added since the last
 *  derivation derives them again. */
function derivedOf(domains: Record<string, TRegisteredDomain>, warn: TVocabularyWarning): TDerived {
	const size = Object.keys(domains).length;
	const held = derivedFor.get(domains);
	if (held && held.size === size) return held;
	const ontology = enumerateStandardVocab(domains, warn).then((standard) => withStandardTerms(ontologyToQuads(domains), standard));
	const derived = { size, records: ontology.then((stated) => [...ontologyRecords(stated), ...domainRecords(domains)]) };
	derivedFor.set(domains, derived);
	return derived;
}

/**
 * Returns the reader of the records the current declarations derive. The declarations are served to every reader as the
 * `@context`, so a read returns the derived records at every level they state, each by its record IRI under the records'
 * namespace.
 */
export function declaredRecordsReader(domains: () => Record<string, TRegisteredDomain>, records: () => TRecordNamespace, warn: TVocabularyWarning): TRecordReader {
	return {
		async readRecords({ accessLevel: _stated, ...everyLevel }: TGraphQuery): Promise<TRecordsPage> {
			const declared = domains();
			return readFromRecords(await derivedOf(declared, warn).records, everyLevel, readDeclarationsOf(declared, records()));
		},
	};
}
