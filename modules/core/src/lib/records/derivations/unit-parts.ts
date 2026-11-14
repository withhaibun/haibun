/**
 * Derives a unit's parts from the node a caller states and the declarations of its types. Each record the node embeds under an
 * edge its type declares `owns` is a part, transitively, and the node's record is the last part, so a store writes what a record
 * owns before the record and its edges to them. A reference names its target by its typed CURIE, and a reference whose type isn't
 * one the edge reaches is refused. Each part's edges take their targets from the declaration (`edgeWriteOf`): an edge the type
 * declares `reference` reaches a record the store may not hold yet, another a record the store holds or the unit writes, an edge it
 * declares `functional` replaces the record's edge to any other, and an edge to an owned part reaches the part the unit writes. A node that embeds a record under an edge its type
 * doesn't declare `owns` is refused.
 */
import { isVocabularyEdge } from "../../domains/hypermedia.js";
import { recordOfIri } from "./record-iri.js";
import type { z } from "zod";
import { unwrap, unwrapToShape, zodTypeLabel } from "../../domains/zod-unwrap.js";
import type { TReadDeclaration } from "./read-records.js";
import { edgeWriteOf, type TEdgeDeclaration, type TEdgeWrite, type TPartDeclaration } from "./edge-declarations.js";
import type { TPartChanges } from "./contract-writes.js";
import {
	NODE_KEY,
	recordOfCurie,
	referenceTo,
	statedVersion,
	WRITE_VERB,
	type TNode,
	type TReadVersion,
	type TRecordName,
	type TReference,
	type TWriteVerb,
} from "../domains/unit.js";
import { contentAddress, contentHash } from "../../domains/content-address.js";
import { LinkRelations, SEQ_PATH_LABEL, type TRecordKey } from "../../domains/resources.js";

/** An edge a part writes from its record: the relation, the type and the id of the record it reaches, whether that record is held
 *  or a reference, and whether the edge replaces the record's earlier edges of the relation. */
export type TUnitEdge = TEdgeWrite & { readonly rel: string; readonly label: string; readonly id: string };

/** One record a unit writes: its type, its id, the fields the node states, a null removing a field, and its edges. A part whose
 *  node names its record by `@id` alone writes its edges, and a store that doesn't hold the record holds a reference in its place
 *  until a write of the record replaces it. `iri` is the `@id` the node states, which a page holds with the record it served. */
export type TPart = TRecordName & {
	readonly fields: Readonly<Record<string, unknown>>;
	readonly edges: readonly TUnitEdge[];
	readonly iri?: string;
	/** The record and the content fields a Body holds, for a Body the unit writes from a record's content fields. */
	readonly contentOf?: TPartChanges;
};

/** A unit as a store writes it: the verb, the version of its record the verb states (null for a record the store doesn't hold,
 *  undefined where the verb doesn't depend on a read), its record, and its parts in the order a store writes them, the record's
 *  own part last. */
export type TUnitParts = { readonly verb: TWriteVerb; readonly version: TReadVersion | undefined; readonly record: TRecordName; readonly parts: readonly TPart[] };

/** The field that identifies a record of a type the declarations don't name. */
export const UNDECLARED_ID_FIELD = "id";

/** The declaration of a vocabulary edge, which any type holds where a node states its targets as references: it reaches a record of
 *  the type each reference names, which the store may not hold. */
const VOCABULARY_EDGE: TEdgeDeclaration = { ranges: [], owns: false, reference: true, functional: false, observesActuality: false };

/** Returns the id an `@id` names: the id of the record IRI it states, or the id it states where it isn't a record IRI. */
const namedId = (iri: unknown): unknown => recordOfIri(iri)?.id ?? iri;

/** Returns the id a node states in its type's id field, or as its `@id`, which a write of its edges alone states, or undefined
 *  where it doesn't state one. Throws where it states two that differ, or an id that isn't a text or a number. */
function statedIdOf(node: Readonly<Record<string, unknown>>, label: string, idField: string): string | undefined {
	const [field, keyword] = [node[idField], namedId(node[NODE_KEY.id])];
	const id = field === undefined ? keyword : field;
	if (id === undefined) return undefined;
	if ((typeof id !== "string" && typeof id !== "number") || String(id).trim() === "" || (keyword !== undefined && String(keyword) !== String(id)))
		throw new Error(`a ${label} record is identified by its "${idField}" field or its "${NODE_KEY.id}", and this record doesn't state one id: ${JSON.stringify([field, keyword])}`);
	return String(id);
}

/** Returns the step that generated a `label` record, as a store's provenance states it on the record's first write: the step in
 *  progress, apart from a step's own record. */
export const generatingStep = (label: string, step: string | undefined): string | undefined => (label === SEQ_PATH_LABEL ? undefined : step);

/** Returns a node as its keys read it: with the step `step` names as its `prov:wasGeneratedBy` where the node doesn't state its own,
 *  since a store states that edge on the record's first write. */
function asGenerated(node: Readonly<Record<string, unknown>>, label: string, step: string | undefined): Readonly<Record<string, unknown>> {
	const generating = generatingStep(label, step);
	const rel = LinkRelations.WAS_GENERATED_BY.rel;
	return generating === undefined || node[rel] !== undefined ? node : { ...node, [rel]: referenceTo(SEQ_PATH_LABEL, generating) };
}

/** Returns the fields a key reads. */
export const keyFieldsOf = (key: TRecordKey): readonly string[] => ("inverseFunctional" in key ? [key.inverseFunctional] : key.address);

/** Returns the keys a refusal names: each key's fields, the keys apart. */
const keysNamed = (keys: readonly TRecordKey[]): string => keys.map((key) => keyFieldsOf(key).join(" and ")).join(", or ");

/** Returns a value of a key's field as its content address reads it: a reference as the typed CURIE it states, which names the
 *  record's type and its id, a list of one value as that value, as a read states an edge's one target in a list, and a list of
 *  values each so. */
const keyValueOf = (value: unknown): unknown =>
	Array.isArray(value) ? (value.length === 1 ? keyValueOf(value[0]) : value.map(keyValueOf)) : isReference(value) ? value[NODE_KEY.id] : value;

/** Returns the id a `label` record's keys derive from a node, through the first key whose fields the node states: the value of its
 *  inverse functional field, or the content address of the values of its fields. Returns undefined where the node doesn't state
 *  every field of any key. */
export function keyedId(label: string, keys: readonly TRecordKey[], node: Readonly<Record<string, unknown>>): string | undefined {
	const key = keys.find((declared) => keyFieldsOf(declared).every((field) => node[field] !== undefined && node[field] !== null));
	if (key === undefined) return undefined;
	if ("address" in key)
		return contentAddress(
			label,
			key.address.map((field) => keyValueOf(node[field])),
		);
	const stated = node[key.inverseFunctional];
	const value = isReference(stated) ? recordOfCurie(stated[NODE_KEY.id])?.id : stated;
	if (typeof value !== "string" || value.trim() === "")
		throw new Error(`a ${label} record is identified by its ${key.inverseFunctional}, and this record states ${JSON.stringify(value)}`);
	return value;
}

/** Returns the id a `label` record's keys derive from a node, as `keyedId` does, for a writer that names the record before it writes
 *  it. Throws where the type doesn't declare keys, or the node doesn't state every field of any key. */
export function derivedId(label: string, keys: readonly TRecordKey[] | undefined, node: Readonly<Record<string, unknown>>): string {
	if (keys === undefined) throw new Error(`${label}'s type doesn't declare keys, so a writer doesn't derive a ${label} record's id. Declare its keys`);
	const id = keyedId(label, keys, node);
	if (id === undefined) throw new Error(`a ${label} record is identified by its key ${keysNamed(keys)}, and this record doesn't state it. State the key`);
	return id;
}

/**
 * Returns the id of a node's record. A type that declares keys identifies a record by the id its keys derive: a node that states
 * a key's fields is written under that id, and a node that states another id is refused. A node that doesn't state a key's fields
 * names a record the store holds by its id, as an update and a write of edges alone do; a write of an edge the type doesn't declare
 * is refused for that edge. A type without keys identifies a record
 * by the id the node states. Throws where the node doesn't state the id its type reads.
 */
function idOf(node: Readonly<Record<string, unknown>>, label: string, declaration: TPartDeclaration | undefined, verb: TWriteVerb, step: string | undefined): string {
	const idField = declaration === undefined ? UNDECLARED_ID_FIELD : declaration.id;
	const stated = statedIdOf(node, label, idField);
	const keys = declaration?.keys;
	const derived = keys === undefined ? stated : keyedId(label, keys, asGenerated(node, label, step));
	if (keys !== undefined && derived !== undefined && stated !== undefined && stated !== derived)
		throw new Error(`a ${label} record's id is derived from its key ${keysNamed(keys)}, which names ${derived}, and this record states the id ${stated}. Leave the id out`);
	if (derived !== undefined) return derived;
	const namesHeld =
		verb === WRITE_VERB.update ||
		Object.entries(node).every(
			([field, value]) =>
				field === NODE_KEY.type || field === NODE_KEY.id || field === idField || edgeOf(declaration, field, value) !== undefined || [value].flat().every(isReference),
		);
	if (keys !== undefined && stated !== undefined && namesHeld) return stated;
	throw new Error(
		keys === undefined
			? `a ${label} record is identified by its "${idField}" field or its "${NODE_KEY.id}", and this record doesn't state one id`
			: `a ${label} record is identified by its key ${keysNamed(keys)}, and this ${verb} doesn't state it. State the key; the store derives the id`,
	);
}

/** Returns the edge a node's key states: the edge the type declares under it, or a vocabulary edge where the vocabulary holds the key
 *  and each of its values is a reference, else undefined for a field. */
function edgeOf(declaration: TPartDeclaration | undefined, key: string, value: unknown): TEdgeDeclaration | undefined {
	return declaration?.edges[key] ?? (isVocabularyEdge(key) && [value].flat().every(isReference) ? VOCABULARY_EDGE : undefined);
}

/** Returns whether a value is a JSON object. */
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Returns whether a value is a reference: an object that states only an `@id`. A key the type doesn't declare is a vocabulary edge
 *  where each of its values is a reference, and a field otherwise. */
const isReference = (value: unknown): value is TReference => isObject(value) && Object.keys(value).length === 1 && typeof value[NODE_KEY.id] === "string";

/** Returns the record a reference under `label`'s edge `rel` names. Throws where its `@id` isn't a typed CURIE of a type the edge
 *  reaches. */
function referencedBy(label: string, rel: string, { ranges }: TEdgeDeclaration, reference: TReference): TRecordName {
	const named = recordOfCurie(reference[NODE_KEY.id]);
	if (named !== undefined && (ranges.length === 0 || ranges.includes(named.label))) return named;
	throw new Error(
		`${label}'s edge ${rel} reaches ${ranges.length === 0 ? "a record" : ranges.join(" or ")} as Type:id, and its reference is ${JSON.stringify(reference[NODE_KEY.id])}. Reference the target with referenceTo`,
	);
}

/** Returns the record an edge field's literal names: the record of the edge's one range whose id the literal states. Throws where
 *  the literal isn't an id, or the edge reaches several types, so the literal doesn't name its target's type. */
function namedByField(label: string, field: string, { ranges }: TEdgeDeclaration, literal: unknown): TRecordName {
	const [range, ...others] = ranges;
	if (typeof literal === "string" && literal.trim() !== "" && range !== undefined && others.length === 0) return { label: range, id: literal };
	throw new Error(`${label}'s field "${field}" names the id of its edge's one target type (${ranges.join(", ")}), and holds ${JSON.stringify(literal)}`);
}

/** Adds an edge to a part, where the part doesn't already write an edge of the relation to the same record. A field and a
 *  reference that name one target then write one edge. */
function addEdge(part: { edges: TUnitEdge[] }, edge: TUnitEdge): void {
	if (!part.edges.some(({ rel, label, id }) => rel === edge.rel && label === edge.label && id === edge.id)) part.edges.push(edge);
}

/**
 * Derives a node's own part and the parts of the records it owns, transitively. A key is an edge where the type declares it, or
 * the vocabulary holds it and each value is a reference, and it holds a record; else it is a field. A key that names both a field
 * of the type's schema and an edge is an edge field: each literal it holds is the id of a record of the edge's range, and the part
 * writes the field and an edge to that record, so every store holds the same edges for the same node. The field holds its
 * literals beside the edge's records, as a JSON-LD property holds literals and nodes: as a list where the schema's field is a
 * list, and its one literal otherwise. An empty list under an edge that isn't a list field of the schema doesn't state a target,
 * so it doesn't write a field or an edge.
 */
function partsOf(
	node: Readonly<Record<string, unknown>>,
	label: string,
	declarationOf: (label: string) => TPartDeclaration | undefined,
	verb: TWriteVerb,
	step: string | undefined,
): { part: TPart; owned: TPart[] } {
	const declaration = declarationOf(label);
	const id = idOf(node, label, declaration, verb, step);
	const iri = node[NODE_KEY.id];
	const part = { label, id, fields: {} as Record<string, unknown>, edges: [] as TUnitEdge[], ...(typeof iri === "string" ? { iri } : {}) };
	const owned: TPart[] = [];
	for (const [key, value] of Object.entries(node)) {
		if (key === NODE_KEY.type || key === NODE_KEY.id || value === undefined) continue;
		const targets = [value].flat();
		const declared = edgeOf(declaration, key, value);
		const records = targets.filter(isObject);
		if (declared !== undefined && targets.length === 0 && declaration?.lists.has(key) !== true) continue;
		if (declared !== undefined && declaration?.fields?.has(key) === true && value !== null)
			for (const named of targets.filter((target) => !isObject(target))) addEdge(part, { rel: key, ...namedByField(label, key, declared, named), ...edgeWriteOf(declared) });
		if (declared === undefined || records.length === 0) {
			if (targets.some(isReference)) throw new Error(`${label} doesn't declare the edge ${key}. Declare it in the type's topology, or write an edge the type declares`);
			part.fields[key] = value;
			continue;
		}
		const literals = targets.filter((target) => !isObject(target));
		if (literals.length > 0) part.fields[key] = literalsOf(label, key, literals, declaration);
		for (const target of records) {
			if (isReference(target)) {
				const to = referencedBy(label, key, declared, target);
				addEdge(part, { rel: key, ...to, ...edgeWriteOf(declared) });
				continue;
			}
			const [{ ranges }, stated] = [declared, target[NODE_KEY.type]];
			const toLabel = typeof stated === "string" ? stated : ranges.length === 1 ? ranges[0] : undefined;
			if (toLabel === undefined) throw new Error(`${label}'s edge ${key} reaches several types, so each target states its "${NODE_KEY.type}"`);
			if (!declared.owns)
				throw new Error(
					`${label} embeds a ${toLabel} record under its edge ${key}, which its type doesn't declare owns. Write the ${toLabel} on its own, and reference it with referenceTo`,
				);
			const embedded = partsOf(target, toLabel, declarationOf, verb, step);
			owned.push(...embedded.owned, embedded.part);
			addEdge(part, { rel: key, label: toLabel, id: embedded.part.id, ...edgeWriteOf({ reference: false, functional: declared.functional }) });
		}
	}
	// A text the type indexes by its digest is written with its digest.
	for (const [field, digest] of Object.entries(declaration?.digests === undefined ? {} : declaration.digests)) {
		const text = part.fields[field];
		if (typeof text === "string") part.fields[digest] = contentHash(text);
	}
	return { part, owned };
}

/** Returns the field a key holds beside its edge's records: its literals as a list where the type's schema holds the field as a
 *  list, and its one literal where the schema holds one value. Throws where the schema doesn't hold the field, or holds one value and the key states several. */
function literalsOf(label: string, key: string, literals: readonly unknown[], declaration: TPartDeclaration | undefined): unknown {
	if (declaration?.lists.has(key)) return literals;
	if (declaration?.fields?.has(key) !== true || literals.length > 1)
		throw new Error(`${label}'s edge ${key} holds ${literals.length} literals beside its records, and its schema doesn't hold them as its field ${key}`);
	return literals[0];
}

/** Returns the parts of the unit a verb writes from a node, and the version of its record the verb states. `step` is the record
 *  name of the step in progress, which a key reads as a record's `prov:wasGeneratedBy`, or undefined outside a step. */
export function unitParts(
	verb: TWriteVerb,
	node: TNode,
	version: TReadVersion | undefined,
	declarationOf: (label: string) => TPartDeclaration | undefined,
	step: string | undefined,
): TUnitParts {
	const label = node[NODE_KEY.type];
	if (typeof label !== "string" || label.length === 0) throw new Error(`a node states its record's type in "${NODE_KEY.type}", and this node doesn't: ${JSON.stringify(node)}`);
	const { part, owned } = partsOf(node, label, declarationOf, verb, step);
	return { verb, version: statedVersion(verb, version), record: { label, id: part.id }, parts: [...owned, part] };
}

/** Returns the fields of a part that change what the store holds: each field whose value differs from the held value, apart from
 *  the field that identifies the record. A field the node restates as the store holds it isn't a change. */
export function changedFields({ fields }: TPart, held: Readonly<Record<string, unknown>> | undefined, idField: string): string[] {
	return Object.entries(fields)
		.filter(
			([field, value]) => field !== idField && (value === null ? held?.[field] !== undefined && held[field] !== null : JSON.stringify(value) !== JSON.stringify(held?.[field])),
		)
		.map(([field]) => field);
}

/** Returns the node of a record a store holds: its type and its fields, as a write of it states them. */
export const nodeOf = (label: string, fields: Readonly<Record<string, unknown>>): TNode => ({ ...fields, [NODE_KEY.type]: label });

/** Returns edges as a node states them: the references to each relation's targets, by relation. */
export const edgesAsNode = (edges: ReadonlyArray<Pick<TUnitEdge, "rel" | "label" | "id">>): Record<string, TReference[]> =>
	Object.fromEntries([...Map.groupBy(edges, ({ rel }) => rel)].map(([rel, held]) => [rel, held.map(({ label, id }) => referenceTo(label, id))]));

/** Returns a record as a read states it, the node its writer states: its fields, and under each relation's key the references to
 *  the relation's targets. A target the key holds embedded, as a read of a unit holds what the record owns, isn't referenced again,
 *  and nor is a target the key names by its id, since a field that names its edge's target writes that edge. */
export function recordNode(fields: Readonly<Record<string, unknown>>, edges: ReadonlyArray<Pick<TUnitEdge, "rel" | "label" | "id">>): Record<string, unknown> {
	const linked = Object.entries(edgesAsNode(edges)).map(([rel, targets]) => {
		const held = fields[rel] === undefined || fields[rel] === null ? [] : [fields[rel]].flat();
		const named = new Set(held.flatMap((value) => (isObject(value) ? [String(namedId(value[NODE_KEY.id]))] : [String(value)])));
		const unnamed = targets.filter((target) => !named.has(String(recordOfCurie(target[NODE_KEY.id])?.id)));
		return [rel, unnamed.length === 0 ? fields[rel] : [...held, ...unnamed]];
	});
	return { ...fields, ...Object.fromEntries(linked) };
}

/** Returns whether a part's node names its record by `@id` alone, without a field, so it writes only its edges. */
export const statesOnlyId = ({ fields }: TPart): boolean => Object.keys(fields).length === 0;

/** Returns a part's fields as a record written whole states them: with its id in the type's id field. */
export const wholeFields = ({ id, fields }: TPart, idField: string): Readonly<Record<string, unknown>> => ({ ...fields, [idField]: id });

/** Each schema's field names and the names of its fields that hold a list, read once. */
const schemaFields = new WeakMap<z.ZodType, Pick<TPartDeclaration, "fields" | "lists">>();

/** Returns what a write reads of a type's read declaration: its id field, its schema's fields, those that hold a list, and its
 *  edges. */
export function partDeclarationOf({
	id,
	keys,
	schema,
	edges,
	digests,
	contents,
	observesActuality,
}: Pick<TReadDeclaration, "id" | "keys" | "schema" | "edges" | "digests" | "contents" | "observesActuality">): TPartDeclaration {
	const digested = {
		...(digests === undefined ? {} : { digests }),
		...(keys === undefined ? {} : { keys }),
		...(contents === undefined ? {} : { contents }),
		...(observesActuality === undefined ? {} : { observesActuality }),
	};
	if (schema === undefined) return { id, fields: undefined, lists: new Set(), edges, ...digested };
	let held = schemaFields.get(schema);
	if (held === undefined) {
		const shaped = unwrapToShape(schema);
		const shape = shaped === null ? [] : Object.entries(shaped);
		held = { fields: new Set(shape.map(([field]) => field)), lists: new Set(shape.flatMap(([field, type]) => (zodTypeLabel(unwrap(type).inner) === "array" ? [field] : []))) };
		schemaFields.set(schema, held);
	}
	return { id, ...held, edges, ...digested };
}
