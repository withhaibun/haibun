/**
 * A record's fields as a view shows them: its type, its id, its title, the fields its field table shows, its governance
 * fields and its body literals, each read through the relations its type declares, and an object's handle.
 */
import { recordOfIri } from "@haibun/core/lib/records/derivations/record-iri.js";
import { TITLE_RELS, composeDisplayLabel, parseTimestampValue, type TTitledBy } from "@haibun/core/lib/domains/hypermedia.js";
import { getRelPresentation, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { STORED_TYPE_PROP } from "../../domains/elements.js";

/** A type's fields by the relation each declares. */
export type TFieldRels = Readonly<Record<string, string>>;

/** The keys a field table doesn't show that a relation doesn't route elsewhere: the property the consumer's graph store
 *  stamps on a parsed row, a storage internal. A key with a domain meaning has a relation in `LinkRelations`, whose
 *  presentation routes it. */
export const SPA_PROPS = new Set([STORED_TYPE_PROP]);

/** Returns a record's persisted type, its JSON-LD `@type`, or undefined for a row that doesn't carry one, as an ad-hoc
 *  result's rows don't. */
export const persistedTypeOf = (v: Record<string, unknown>): string | undefined => (typeof v["@type"] === "string" && v["@type"] !== "" ? v["@type"] : undefined);

/** Returns the handle of a graph object from its type and id. The column pane's id, a test id, the graph view's node and a
 *  test address an object by it; the store's vertex id stays the object's own id. */
export const objectId = (type: string, id: string): string => `${type}:${id}`;

/** Returns the id a record's JSON-LD `@id` states: the id of a record IRI, or the `@id` itself where it names the record by
 *  its id; or the value of its type's id field, which `idFieldOf` returns, where the record doesn't carry an `@id`. Throws for
 *  a record without an `@id` and without the value of its type's id field. */
export function idOf(v: Record<string, unknown>, idFieldOf: (type: string) => string | undefined): string {
	const iri = v["@id"];
	if (typeof iri === "string" && iri.length > 0) return recordOfIri(iri)?.id ?? iri;
	const type = persistedTypeOf(v);
	const idField = type === undefined ? undefined : idFieldOf(type);
	const id = idField === undefined ? undefined : v[idField];
	if (typeof id !== "string" && typeof id !== "number") throw new Error("a record doesn't carry an @id or the id field its type declares, so a view can't address it");
	return String(id);
}

/** Returns the fields that title a type's records: the field its declaration names, then the fields of its properties
 *  `rels` that carry a title relation. */
export function titleFields(rels: TFieldRels | undefined, titledBy: TTitledBy | undefined): string[] {
	const byRel = Object.entries(rels === undefined ? {} : rels)
		.filter(([, rel]) => TITLE_RELS.includes(rel))
		.map(([field]) => field);
	return titledBy === undefined ? byRel : [titledBy.key, ...byRel];
}

/** Returns a record's title: the field its type declares, then a title relation of its properties `rels`, then `id`. */
export const instanceLabel = (v: Record<string, unknown>, rels: TFieldRels | undefined, titledBy: TTitledBy | undefined, id: string): string =>
	composeDisplayLabel({ rels, getProperty: (field) => v[field], ...(titledBy ? { displayLabel: titledBy } : {}), id });

/** Whether a key is a projection key (`@…`, `_…`), which a view's sections don't show as a field. */
export const isProjectionKey = (k: string): boolean => k.startsWith("_") || k.startsWith("@");

/** Whether a relation routes its field to the body or the governance section. */
const routedElsewhere = (rel: string): boolean => {
	const presentation = getRelPresentation(rel);
	return presentation === "body" || presentation === "governance";
};

/** Whether the field table shows key `k`, where `rels` are its type's field relations, or undefined for a record without a
 *  type. A key it doesn't show is a projection key (`@…`, `_…`), a key of `SPA_PROPS`, or a key whose own name or declared
 *  relation routes it to the body or the governance section. */
export function isVisibleKey(k: string, rels: TFieldRels | undefined): boolean {
	if (isProjectionKey(k) || SPA_PROPS.has(k) || routedElsewhere(k)) return false;
	const rel = rels?.[k];
	return rel === undefined || !routedElsewhere(rel);
}

/** Returns the fields of a record whose relation is a governance relation: who may see it, what it allows, whether it is
 *  revoked. The field table leaves them out, and the governance section shows them. */
export function governanceFields(vertex: Record<string, unknown>, rels: TFieldRels | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(vertex)) {
		if (isProjectionKey(k) || v === undefined || v === null) continue;
		const rel = rels?.[k] ?? k;
		if (getRelPresentation(rel) === "governance") out[k] = typeof v === "string" ? v : JSON.stringify(v);
	}
	return out;
}

/** Whether the references section shows an edge: an edge whose relation routes it to the body or the governance
 *  section shows there. */
export const isReferenceEdge = (edgeType: string): boolean => !routedElsewhere(edgeType);

/** Returns a record's fields as the field table shows them: each visible key's scalar or list of scalars as text. A list of
 *  objects shows in the items table. */
export function extractFieldEntries(vertex: Record<string, unknown>, rels: TFieldRels | undefined): Record<string, string | string[]> {
	const fields: Record<string, string | string[]> = {};
	for (const [k, v] of Object.entries(vertex)) {
		if (!isVisibleKey(k, rels)) continue;
		if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") continue;
		fields[k] = Array.isArray(v) ? (v as unknown[]).map((x) => String(x)) : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
	}
	return fields;
}

/** Returns a record's literal body fields: an inline text whose relation is a body relation, as a SeqPath's `stepText`
 *  carries `content`. The field table leaves body fields out, and the body section shows a linked body, so these show
 *  inline. A linked body, a list of Body records, isn't a text. */
export function extractBodyLiterals(vertex: Record<string, unknown>, rels: TFieldRels | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(vertex)) {
		if (typeof v !== "string" || v.length === 0 || isProjectionKey(k)) continue;
		const rel = getRelPresentation(k) ? k : rels?.[k];
		if (rel !== undefined && getRelPresentation(rel) === "body") out[k] = v;
	}
	return out;
}

/** Returns when a record was made, by the field its type declares the creation relation, else the published relation.
 *  Returns null for a type without either field, or a field that doesn't hold a time. */
export function recordTime(vertex: Record<string, unknown>, rels: TFieldRels): number | null {
	for (const rel of [LinkRelations.GENERATED_AT_TIME.rel, LinkRelations.PUBLISHED.rel]) {
		const field = Object.keys(rels).find((name) => rels[name] === rel);
		if (field !== undefined) return parseTimestampValue(vertex[field]);
	}
	return null;
}
