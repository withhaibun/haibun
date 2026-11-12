/**
 * Derives a unit's parts from the node a caller states and the declarations of its types. Each record the node embeds under an
 * edge its type declares `owns` is a part, transitively, and the node's record is the last part, so a store writes what a record
 * owns before the record and its edges to them. A reference names its target by its typed CURIE, and a reference whose type isn't
 * one the edge reaches is refused. Each part's edges take their targets from the declaration (`edgeWriteOf`): an edge the type
 * declares `reference` reaches a record the store may not hold yet, another a record the store holds or the unit writes, an edge it
 * declares `functional` replaces the record's edge to any other, and an edge to an owned part reaches the part the unit writes. A node that embeds a record under an edge its type
 * doesn't declare `owns` is refused.
 */
import { isVocabularyEdge, textDigest } from "../../domains/hypermedia.js";
import { recordOfIri } from "./record-iri.js";
import type { z } from "zod";
import { unwrap, unwrapToShape, zodTypeLabel } from "../../domains/zod-unwrap.js";
import type { TReadDeclaration } from "./read-records.js";
import { edgeWriteOf, type TEdgeDeclaration, type TEdgeWrite, type TPartDeclaration } from "./edge-declarations.js";
import { NODE_KEY, recordOfCurie, referenceTo, statedVersion, type TNode, type TReadVersion, type TRecordName, type TReference, type TWriteVerb } from "../domains/unit.js";

/** An edge a part writes from its record: the relation, the type and the id of the record it reaches, whether that record is held
 *  or a reference, and whether the edge replaces the record's earlier edges of the relation. */
export type TUnitEdge = TEdgeWrite & { readonly rel: string; readonly label: string; readonly id: string };

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
 *  the type each reference names, which the store may not hold. */
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

/**
 * Derives a node's own part and the parts of the records it owns, transitively. A key is an edge where the type declares it, or
 * the vocabulary holds it and each value is a reference, and it holds a record; else it is a field. A key that names both a field
 * of the type's schema and an edge holds the field's literals beside the edge's records, as a JSON-LD property holds literals
 * and nodes: the field holds its literals as a list where the schema's field is a list, and its one literal otherwise. An empty
 * list under an edge that isn't a list field of the schema doesn't state a target, so it doesn't write a field or an edge.
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
		if (declared !== undefined && targets.length === 0 && declaration?.lists.has(key) !== true) continue;
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
				part.edges.push({ rel: key, ...to, ...edgeWriteOf(declared) });
				continue;
			}
			const [{ ranges }, stated] = [declared, target[NODE_KEY.type]];
			const toLabel = typeof stated === "string" ? stated : ranges.length === 1 ? ranges[0] : undefined;
			if (toLabel === undefined) throw new Error(`${label}'s edge ${key} reaches several types, so each target states its "${NODE_KEY.type}"`);
			if (!declared.owns)
				throw new Error(
					`${label} embeds a ${toLabel} record under its edge ${key}, which its type doesn't declare owns. Write the ${toLabel} on its own, and reference it with referenceTo`,
				);
			const embedded = partsOf(target, toLabel, declarationOf);
			owned.push(...embedded.owned, embedded.part);
			part.edges.push({ rel: key, label: toLabel, id: embedded.part.id, ...edgeWriteOf({ reference: false, functional: declared.functional }) });
		}
	}
	// A text the type indexes by its digest is written with its digest.
	for (const [field, digest] of Object.entries(declaration?.digests === undefined ? {} : declaration.digests)) {
		const text = part.fields[field];
		if (typeof text === "string") part.fields[digest] = textDigest(text);
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
export function partDeclarationOf({ id, schema, edges, digests }: Pick<TReadDeclaration, "id" | "schema" | "edges" | "digests">): TPartDeclaration {
	const digested = digests === undefined ? {} : { digests };
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
