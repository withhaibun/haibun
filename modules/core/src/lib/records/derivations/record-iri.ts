/**
 * A record's IRI, which its JSON-LD `@id` states and its N3 individual expands: the records' prefix, its type's label in lower
 * case, a slash and its id percent-encoded as an RFC 3986 path segment. The served @context binds the prefix to the records'
 * namespace, so the IRI is the same whatever scheme the namespace has, and a change of namespace is a change of context.
 */
import { itemAt } from "../../domains/item-at.js";

/** The characters encodeURIComponent leaves that RFC 3986 reserves as sub-delimiters. */
const SUB_DELIMITERS = /[!'()*]/g;
/** A record's IRI: a prefix, a label in lower case and an id of unreserved characters and percent-encoded octets. */
const RECORD_IRI = /^([A-Za-z][\w-]*):([^/:]+)\/((?:[\w.~-]|%[\dA-F]{2})+)$/;

/** Returns a record's IRI under the records' prefix, from its type's label and its id. */
export const recordIri = (prefix: string, label: string, id: string): string =>
	`${prefix}:${label.toLowerCase()}/${encodeURIComponent(id).replace(SUB_DELIMITERS, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/** Returns the prefix, the lower-case label and the id a record's IRI states, which reverses recordIri, or undefined where the
 *  text isn't a record's IRI. */
export function recordOfIri(iri: string): { prefix: string; lowerLabel: string; id: string } | undefined {
	const named = RECORD_IRI.exec(iri);
	return named === null ? undefined : { prefix: itemAt(named, 1), lowerLabel: itemAt(named, 2), id: decodeURIComponent(itemAt(named, 3)) };
}
