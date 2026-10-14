/**
 * Read declarations for a test store's own types. A store of quads reads a type's records only where it holds the type's
 * declaration, so a test that writes records of a type it names declares that type here.
 */
import { REACHED_BY } from "../hypermedia.js";
import { QuadStore, newStoreChain } from "../steps/pipelines/quad-store.js";
import type { TStoreLevels } from "../steps/ports.js";
import { LinkRelations, type TDomainDefinition } from "../resources.js";
import { mapDefinitionsToDomains } from "../domains.js";
import { readDeclarationsOf, type TReadDeclarations } from "../records/derivations/read-records.js";

/** The fields and relations of one test type, and the field that identifies its records where it isn't `id`. A relation
 *  maps to the types at its other end. */
export type TDeclaredType = { id?: string; filters?: readonly string[]; relations?: Record<string, readonly string[]> };

/** Returns read declarations of the types `types` names. Each type's id field is the one it names or `id`, its filters
 *  compare the fields it names, and a page of it orders by `generatedAtTime`. */
export function declaredTypes(types: Record<string, TDeclaredType>): TReadDeclarations {
	const relations = [...new Set(Object.values(types).flatMap((type) => (type.relations === undefined ? [] : Object.keys(type.relations))))].sort();
	return {
		types: Object.keys(types).sort(),
		relations,
		of(label) {
			const type = types[label];
			if (!type) return undefined;
			const properties = Object.fromEntries((type.filters ?? []).map((field) => [field, [REACHED_BY.filter]]));
			const references = Object.fromEntries((type.relations === undefined ? [] : Object.entries(type.relations)).map(([relation, ranges]) => [relation, [...ranges]]));
			return { id: type.id === undefined ? "id" : type.id, surface: { label, properties, references }, defaultSort: LinkRelations.GENERATED_AT_TIME.rel };
		},
	};
}

/** Returns an in-memory store that reads the records of the types `types` names. */
export function storeDeclaring(types: Record<string, TDeclaredType>, levels?: TStoreLevels): QuadStore {
	return new QuadStore(newStoreChain(), levels, () => declaredTypes(types));
}

/** Returns an in-memory store that reads the records of the persisted types `definitions` declares. */
export function storeOfDomains(definitions: TDomainDefinition[], levels?: TStoreLevels): QuadStore {
	const declarations = readDeclarationsOf(mapDefinitionsToDomains(definitions));
	return new QuadStore(newStoreChain(), levels, () => declarations);
}
