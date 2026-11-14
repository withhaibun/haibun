/**
 * Read declarations for a test store's own types. A store of quads reads a type's records only where it holds the type's
 * declaration, so a test that writes records of a type it names declares that type here.
 */
import type { z } from "zod";
import { querySurface, REACHED_BY } from "../domains/hypermedia.js";
import { QuadStore, newStoreChain } from "../steps/pipelines/quad-store.js";
import type { TStoreLevels } from "../steps/ports.js";
import { Access, contentFieldsOf, HAIBUN_RECORD_NAMESPACE, isPersisted, LinkRelations, type TContentField, type TDomainDefinition, type TRecordKey } from "../domains/resources.js";
import { accessBound, inCall, inStep, runInCall, writeBound, writesInFlight } from "../domains/capability-context.js";
import { stepRecordInFlight } from "../actuality/domains/step-in-flight.js";
import { formatRecordName } from "../actuality/domains/seq-path.js";
import { mapDefinitionsToDomains } from "../domains/domains.js";
import { readDeclarationsOf, servedIdOf, type TReadDeclarations } from "../records/derivations/read-records.js";
import { recordIri } from "../records/derivations/record-iri.js";
import { edgeDeclarationsOf, type TEdgeDeclaration } from "../records/derivations/edge-declarations.js";

/** The fields and relations of one test type, the field that identifies its records where it isn't `id`, the domain time
 *  field that places its records in time where it isn't `generatedAtTime`, and the sets of fields that two of its records don't share.
 *  A relation maps to the types at its other end. */
export type TDeclaredType = {
	id?: string;
	time?: string;
	filters?: readonly string[];
	relations?: Record<string, readonly string[]>;
	schema?: z.ZodType;
	unique?: readonly (readonly string[])[];
	/** The edges a write reads, where they own, reference or reach one record; else each relation is an edge to a held record. */
	edges?: Readonly<Record<string, TEdgeDeclaration>>;
	/** The keys a record's id is derived from, where the type declares them. */
	keys?: readonly TRecordKey[];
	/** The content fields the type declares, where it declares one. */
	contents?: readonly TContentField[];
	/** Set where the type's records record what actuality did. */
	observesActuality?: true;
};

/** Returns read declarations of the types `types` names. Each type's id field is the one it names or `id`, its filters
 *  compare the fields it names, a page of it orders by its domain time field or `generatedAtTime`, and a read states each
 *  record's IRI, derived under haibun's namespace. */
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
			const edges = type.edges === undefined ? edgeDeclarationsOf(Object.fromEntries(Object.entries(references).map(([relation, range]) => [relation, { range }]))) : type.edges;
			const declared = {
				id: type.id === undefined ? "id" : type.id,
				surface: { label, properties, references },
				defaultSort: type.time === undefined ? LinkRelations.GENERATED_AT_TIME.rel : type.time,
				edges,
				properties: new Set<string>(),
			};
			return {
				...declared,
				...(type.schema === undefined ? {} : { schema: type.schema }),
				...(type.unique === undefined ? {} : { unique: type.unique }),
				...(type.keys === undefined ? {} : { keys: type.keys }),
				...(type.contents === undefined ? {} : { contents: type.contents }),
				...(type.observesActuality === undefined ? {} : { observesActuality: type.observesActuality }),
			};
		},
	};
}

/** Returns the test declaration of a persisted type its definition declares: its id field, the edges its topology declares and its schema. */
export function declaredTypeOf({ schema, topology }: TDomainDefinition): [string, TDeclaredType] {
	if (!isPersisted(topology)) throw new Error("a test declares a persisted type, and this definition doesn't persist one. Pass a persisted type's definition.");
	const contents = contentFieldsOf(topology.properties);
	return [
		topology.persistedAs,
		{
			id: topology.id,
			relations: querySurface({ schema, topology }).references,
			schema,
			edges: edgeDeclarationsOf(topology.edges),
			...(topology.keys === undefined ? {} : { keys: topology.keys }),
			...(contents.length === 0 ? {} : { contents }),
		},
	];
}

/** Returns read declarations of the types `types` names as a page reads them: a read states the `@id` the instance served,
 *  which the page holds with the record. */
export const servedTypes = (types: Record<string, TDeclaredType>): TReadDeclarations => ({ ...declaredTypes(types), idOf: servedIdOf });

/** Returns the record IRI of the record of `label` with `id`, under haibun's namespace. */
export const heldRecordIri = (label: string, id: string): string => recordIri(HAIBUN_RECORD_NAMESPACE.prefix, label, id);

/** The actuality feature of a test's steps. */
const TEST_ACTUALITY = "test";

/** Runs `call` within the step at `seqPath`, as a step's dispatch runs its action, so a store states the step as the provenance of
 *  each record `call` writes. */
export const inTestStep = <T>(seqPath: string, call: () => T): T => runInCall(inStep(inCall(), { seqPath, reportsAt: undefined }), call);

/** Returns the record name of the step `inTestStep` runs the call in progress in, as a store's provenance reads it. */
export const testCurrentStep = (): string | undefined => stepRecordInFlight(TEST_ACTUALITY);

/** Returns the record name of the step that `inTestStep` runs at `seqPath`. */
export const testStepRecord = (seqPath: string): string => formatRecordName({ actuality: TEST_ACTUALITY, path: seqPath.split(".").map(Number) });

/** The levels of a test's store that holds what a writer writes, as actuality's store does: it reads and writes within the call in
 *  progress, holds a record that doesn't state its level at private, checks each write against the step in progress, and states
 *  each record's provenance on the system clock. A store without levels holds a copy of what a site served, which the site
 *  stamped. */
export const TEST_LEVELS: TStoreLevels = {
	bound: accessBound,
	writeBound,
	declared: (type) => ({ type, levels: [Access.private] }),
	stepWrites: writesInFlight,
	currentStep: testCurrentStep,
	recordTime: () => new Date().toISOString(),
};

/** Returns an in-memory store that reads the records of the types `types` names. */
export function storeDeclaring(types: Record<string, TDeclaredType>, levels?: TStoreLevels): QuadStore {
	return new QuadStore(newStoreChain(), levels, () => declaredTypes(types));
}

/** Returns an in-memory store that reads the records of the persisted types `definitions` declares. */
export function storeOfDomains(definitions: TDomainDefinition[], levels?: TStoreLevels): QuadStore {
	const declarations = readDeclarationsOf(mapDefinitionsToDomains(definitions), HAIBUN_RECORD_NAMESPACE);
	return new QuadStore(newStoreChain(), levels, () => declarations);
}
