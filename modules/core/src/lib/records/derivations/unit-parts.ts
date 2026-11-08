/**
 * Derives a unit's parts from the node a caller states and the declarations of its types. Each record the node embeds under an
 * edge its type declares `owns` is a part, transitively, and the node's record is the last part, so a store writes what a record
 * owns before the record and its edges to them. Each part's edges take their targets from the declaration: an edge the type
 * declares `reference` reaches a record the store may not hold yet, an edge it declares `functional` replaces the record's edge to
 * any other, and an edge to an owned part reaches the part the unit writes. A node that embeds a record under an edge its type
 * doesn't declare `owns` is refused.
 */
import { isVocabularyEdge } from "../../domains/hypermedia.js";
import { recordOfIri } from "./record-iri.js";
import type { z } from "zod";
import { unwrap, unwrapToShape, zodTypeLabel } from "../../domains/zod-unwrap.js";
import type { TReadDeclaration } from "./read-records.js";
import { EDGE_TARGET, type TEdgeDeclaration, type TEdgeTarget, type TPartDeclaration } from "./edge-declarations.js";
import { NODE_KEY, statedVersion, type TNode, type TReadVersion, type TRecordName, type TWriteVerb } from "../domains/unit.js";

/** An edge a part writes from its record: the relation, the type and the id of the record it reaches, and how it reaches it. */
export type TUnitEdge = { readonly rel: string; readonly label: string; readonly id: string; readonly target: TEdgeTarget };

/** One record a unit writes: its type, its id, the fields the node states, a null removing a field, and its edges. A part whose
 *  node names its record by `@id` alone writes its edges, and a store that doesn't hold the record holds a reference in its place
 *  until a write of the record replaces it. `iri` is the `@id` the node states, which a page holds with the record it served. */
export type TPart = TRecordName & { readonly fields: Readonly<Record<string, unknown>>; readonly edges: readonly TUnitEdge[]; readonly iri?: string };

/** A unit as a store writes it: the verb, the version of its record the verb states (null for a record the store doesn't hold,
 *  undefined where the verb doesn't depend on a read), its record, and its parts in the order a store writes them, the record's
 *  own part last. */
export type TUnitParts = { readonly verb: TWriteVerb; readonly version: TReadVersion | undefined; readonly record: TRecordName; readonly parts: readonly TPart[] };

/** The field that identifies a record of a type the declarations don't name. */
export const UNDECLARED_ID_FIELD = "id";

/** The declaration of a vocabulary edge, which any type holds where a node states its targets as references: it reaches a record of
 *  the type each reference states, which the store may not hold. */
const VOCABULARY_EDGE: TEdgeDeclaration = { ranges: [], owns: false, reference: true, functional: false };

/** Returns the id an `@id` names: the id of the record IRI it states, or the id it states where it isn't a record IRI. */
const namedId = (iri: unknown): unknown => recordOfIri(iri)?.id ?? iri;

/** Returns the id a node states in its type's id field, or as its `@id`, which a write of its edges alone states. Throws where it
 *  doesn't state one, or states two that differ. */
function idOf(node: Readonly<Record<string, unknown>>, label: string, idField: string): string {
	const [field, keyword] = [node[idField], namedId(node[NODE_KEY.id])];
	const id = field === undefined ? keyword : field;
	if ((typeof id !== "string" && typeof id !== "number") || String(id).trim() === "" || (keyword !== undefined && String(keyword) !== String(id)))
		throw new Error(`a ${label} record is identified by its "${idField}" field or its "${NODE_KEY.id}", and this record doesn't state one id: ${JSON.stringify([field, keyword])}`);
	return String(id);
}

/** Returns whether a value is a JSON object. */
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Returns whether a value is a reference: an object that states only a record's `@type` and `@id`. A key the type doesn't declare
 *  is a vocabulary edge where each of its values is a reference, and a field otherwise. */
const isReference = (value: unknown): value is Readonly<Record<string, unknown>> =>
	isObject(value) && NODE_KEY.id in value && Object.keys(value).every((key) => key === NODE_KEY.type || key === NODE_KEY.id);

/**
 * Derives a node's own part and the parts of the records it owns, transitively. A key is an edge where the type declares it, or
 * the vocabulary holds it and each value is a reference, and it holds a record; else it is a field. A key that names both a field
 * of the type's schema and an edge holds the field's literals beside the edge's records, as a JSON-LD property holds literals
 * and nodes: the field holds its literals as a list where the schema's field is a list, and its one literal otherwise.
 */
function partsOf(node: Readonly<Record<string, unknown>>, label: string, declarationOf: (label: string) => TPartDeclaration | undefined): { part: TPart; owned: TPart[] } {
	const declaration = declarationOf(label);
	const id = idOf(node, label, declaration === undefined ? UNDECLARED_ID_FIELD : declaration.id);
	const iri = node[NODE_KEY.id];
	const part = { label, id, fields: {} as Record<string, unknown>, edges: [] as TUnitEdge[], ...(typeof iri === "string" ? { iri } : {}) };
	const owned: TPart[] = [];
	for (const [key, value] of Object.entries(node)) {
		if (key === NODE_KEY.type || key === NODE_KEY.id || value === undefined) continue;
		const targets = [value].flat();
		const declared = declaration?.edges[key] ?? (isVocabularyEdge(key) && targets.every(isReference) ? VOCABULARY_EDGE : undefined);
		const records = targets.filter(isObject);
		if (declared === undefined || records.length === 0) {
			if (targets.some(isReference)) throw new Error(`${label} doesn't declare the edge ${key}. Declare it in the type's topology, or write an edge the type declares`);
			part.fields[key] = value;
			continue;
		}
		const literals = targets.filter((target) => !isObject(target));
		if (literals.length > 0) part.fields[key] = literalsOf(label, key, literals, declaration);
		for (const target of records) {
			const [{ ranges }, stated] = [declared, target[NODE_KEY.type]];
			const toLabel = typeof stated === "string" ? stated : ranges.length === 1 ? ranges[0] : undefined;
			if (toLabel === undefined) throw new Error(`${label}'s edge ${key} reaches several types, so each target states its "${NODE_KEY.type}"`);
			if (isReference(target)) {
				const to = String(namedId(target[NODE_KEY.id]));
				part.edges.push({ rel: key, label: toLabel, id: to, target: declared.reference ? EDGE_TARGET.reference : declared.functional ? EDGE_TARGET.only : EDGE_TARGET.held });
				continue;
			}
			if (!declared.owns)
				throw new Error(
					`${label} embeds a ${toLabel} record under its edge ${key}, which its type doesn't declare owns. Write the ${toLabel} on its own, and reach it by its "${NODE_KEY.id}"`,
				);
			const embedded = partsOf(target, toLabel, declarationOf);
			owned.push(...embedded.owned, embedded.part);
			part.edges.push({ rel: key, label: toLabel, id: embedded.part.id, target: EDGE_TARGET.held });
		}
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

/** Returns the parts of the unit a verb writes from a node, and the version of its record the verb states. */
export function unitParts(verb: TWriteVerb, node: TNode, version: TReadVersion | undefined, declarationOf: (label: string) => TPartDeclaration | undefined): TUnitParts {
	const label = node[NODE_KEY.type];
	if (typeof label !== "string" || label.length === 0) throw new Error(`a node states its record's type in "${NODE_KEY.type}", and this node doesn't: ${JSON.stringify(node)}`);
	const { part, owned } = partsOf(node, label, declarationOf);
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
export const edgesAsNode = (edges: ReadonlyArray<Pick<TUnitEdge, "rel" | "label" | "id">>): Record<string, Array<Record<string, string>>> =>
	Object.fromEntries([...Map.groupBy(edges, ({ rel }) => rel)].map(([rel, held]) => [rel, held.map(({ label, id }) => ({ [NODE_KEY.type]: label, [NODE_KEY.id]: id }))]));

/** Returns whether a part's node names its record by `@id` alone, without a field, so it writes only its edges. */
export const statesOnlyId = ({ fields }: TPart): boolean => Object.keys(fields).length === 0;

/** Returns a part's fields as a record written whole states them: with its id in the type's id field. */
export const wholeFields = ({ id, fields }: TPart, idField: string): Readonly<Record<string, unknown>> => ({ ...fields, [idField]: id });

/** Each schema's field names and the names of its fields that hold a list, read once. */
const schemaFields = new WeakMap<z.ZodType, Pick<TPartDeclaration, "fields" | "lists">>();

/** Returns what a write reads of a type's read declaration: its id field, its schema's fields, those that hold a list, and its
 *  edges. */
export function partDeclarationOf({ id, schema, edges }: Pick<TReadDeclaration, "id" | "schema" | "edges">): TPartDeclaration {
	if (schema === undefined) return { id, fields: undefined, lists: new Set(), edges };
	let held = schemaFields.get(schema);
	if (held === undefined) {
		const shaped = unwrapToShape(schema);
		const shape = shaped === null ? [] : Object.entries(shaped);
		held = { fields: new Set(shape.map(([field]) => field)), lists: new Set(shape.flatMap(([field, type]) => (zodTypeLabel(unwrap(type).inner) === "array" ? [field] : []))) };
		schemaFields.set(schema, held);
	}
	return { id, ...held, edges };
}
