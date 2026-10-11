/**
 * A record's fields as a view shows them (`page/derivations/record-fields.ts`), read through the relations its type declares
 * in the catalog the page holds. A read that needs a type's declaration throws before the page reads actuality's steps.
 */
import { pageRegistry } from "../root.js";
import { heldCatalog } from "../pipelines/held-catalog.js";
import * as Fields from "../derivations/record-fields.js";
import type { TCatalog } from "../derivations/catalog.js";

const held = (what: string): TCatalog => heldCatalog(pageRegistry(), what);

/** Returns the field relations of `label`, or undefined for a record without a type. */
const fieldRelsOf = (label: string | undefined, what: string): Fields.TFieldRels | undefined => (label ? held(`${what} of ${label}`).fieldRels[label] : undefined);

/** Returns a record's id: the tail of its `@id`, else its type's id field. */
export const idOf = (v: Record<string, unknown>): string => Fields.idOf(v, (type) => held(`the id field of ${type}`).idFields[type]);

/** Returns the fields that title a type's records. */
export function titleFields(label: string): string[] {
	const catalog = held(`the title fields of ${label}`);
	return Fields.titleFields(catalog.rels[label], catalog.titledBy[label]);
}

/** Returns a record's title. */
export function instanceLabel(v: Record<string, unknown>): string {
	const type = Fields.persistedTypeOf(v);
	const catalog = held("a record's title");
	return Fields.instanceLabel(v, type === undefined ? undefined : catalog.rels[type], type === undefined ? undefined : catalog.titledBy[type], idOf(v));
}

/** Whether the field table of a record of `label` shows key `k`. */
export const isVisibleKey = (k: string, label?: string): boolean => Fields.isVisibleKey(k, fieldRelsOf(label, `whether the field table shows ${k}`));

/** Returns a record's governance fields. */
export const governanceFields = (vertex: Record<string, unknown>, label?: string): Record<string, string> =>
	Fields.governanceFields(vertex, fieldRelsOf(label, "the governance fields"));

/** Returns a record's fields as the field table shows them. */
export const extractFieldEntries = (vertex: Record<string, unknown>, label?: string): Record<string, string | string[]> =>
	Fields.extractFieldEntries(vertex, fieldRelsOf(label, "the field table"));

/** Returns a record's literal body fields. */
export const extractBodyLiterals = (vertex: Record<string, unknown>, label?: string): Record<string, string> =>
	Fields.extractBodyLiterals(vertex, fieldRelsOf(label, "the body literals"));
