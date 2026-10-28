/**
 * Read declarations for a test store's own types. A store of quads reads a type's records only where it holds the type's
 * declaration, so a test that writes records of a type it names declares that type here.
 */
import { querySurface, REACHED_BY } from "../domains/hypermedia.js";
import { QuadStore, newStoreChain } from "../steps/pipelines/quad-store.js";
import type { TStoreLevels } from "../steps/ports.js";
import { HAIBUN_RECORD_NAMESPACE, isPersisted, LinkRelations, type TDomainDefinition } from "../domains/resources.js";
import { mapDefinitionsToDomains } from "../domains/domains.js";
import { readDeclarationsOf, servedIdOf, type TReadDeclarations } from "../records/derivations/read-records.js";
import { recordIri } from "../records/derivations/record-iri.js";

/** The fields and relations of one test type, and the field that identifies its records where it isn't `id`. A relation
 *  maps to the types at its other end. */
export type TDeclaredType = { id?: string; filters?: readonly string[]; relations?: Record<string, readonly string[]> };

/** Returns read declarations of the types `types` names. Each type's id field is the one it names or `id`, its filters
 *  compare the fields it names, a page of it orders by `generatedAtTime`, and a read states each record's IRI, derived under
 *  haibun's namespace. */
export function declaredTypes(types: Record<string, TDeclaredType>): TReadDeclarations {
	const relations = [...new Set(Object.values(types).flatMap((type) => (type.relations === undefined ? [] : Object.keys(type.relations))))].sort();
	return {
		types: Object.keys(types).sort(),
		relations,
		idOf: ({ label, id }) => recordIri(HAIBUN_RECORD_NAMESPACE.prefix, label, id),
		of(label) {
			const type = types[label];
			if (!type) return undefined;
			const properties = Object.fromEntries((type.filters ?? []).map((field) => [field, [REACHED_BY.filter]]));
			const references = Object.fromEntries((type.relations === undefined ? [] : Object.entries(type.relations)).map(([relation, ranges]) => [relation, [...ranges]]));
			return { id: type.id === undefined ? "id" : type.id, surface: { label, properties, references }, defaultSort: LinkRelations.GENERATED_AT_TIME.rel };
		},
	};
}

/** Returns the test declaration of a persisted type its definition declares: its id field and the edges its topology declares. */
export function declaredTypeOf({ schema, topology }: TDomainDefinition): [string, TDeclaredType] {
	if (!isPersisted(topology)) throw new Error("a test declares a persisted type, and this definition doesn't persist one. Pass a persisted type's definition.");
	return [topology.persistedAs, { id: topology.id, relations: querySurface({ schema, topology }).references }];
}

/** Returns read declarations of the types `types` names as a page reads them: a read states the `@id` the instance served,
 *  which the page holds with the record. */
export const servedTypes = (types: Record<string, TDeclaredType>): TReadDeclarations => ({ ...declaredTypes(types), idOf: servedIdOf });

/** Returns the record IRI of the record of `label` with `id`, under haibun's namespace. */
export const heldRecordIri = (label: string, id: string): string => recordIri(HAIBUN_RECORD_NAMESPACE.prefix, label, id);

/** Returns an in-memory store that reads the records of the types `types` names. */
export function storeDeclaring(types: Record<string, TDeclaredType>, levels?: TStoreLevels): QuadStore {
	return new QuadStore(newStoreChain(), levels, () => declaredTypes(types));
}

/** Returns an in-memory store that reads the records of the persisted types `definitions` declares. */
export function storeOfDomains(definitions: TDomainDefinition[], levels?: TStoreLevels): QuadStore {
	const declarations = readDeclarationsOf(mapDefinitionsToDomains(definitions), HAIBUN_RECORD_NAMESPACE);
	return new QuadStore(newStoreChain(), levels, () => declarations);
}
