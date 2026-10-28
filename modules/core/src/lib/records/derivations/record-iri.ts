/**
 * A record's IRI, which its JSON-LD `@id` states and its N3 individual expands: the records' prefix, its type's label in lower
 * case, a slash and its id percent-encoded as an RFC 3986 path segment. The served @context binds the prefix to the records'
 * namespace, so the IRI is the same whatever scheme the namespace has, and a change of namespace is a change of context.
 */

/** The characters encodeURIComponent leaves that RFC 3986 reserves as sub-delimiters. */
const SUB_DELIMITERS = /[!'()*]/g;
/** An id as recordIri encodes it: unreserved characters and percent-encoded octets. */
const ENCODED_ID = /^(?:[A-Za-z\d\-._~]|%[\dA-F]{2})+$/;

/** Returns a record's IRI under the records' prefix, from its type's label and its id. */
export const recordIri = (prefix: string, label: string, id: string): string =>
	`${prefix}:${label.toLowerCase()}/${encodeURIComponent(id).replace(SUB_DELIMITERS, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/** Returns the lower-case label and the id a record's IRI states under the records' prefix, which reverses recordIri, or
 *  undefined where the IRI isn't a record's IRI under that prefix. */
export function recordOfIri(prefix: string, iri: string): { lowerLabel: string; id: string } | undefined {
	if (!iri.startsWith(`${prefix}:`)) return undefined;
	const path = iri.slice(prefix.length + 1);
	const slash = path.indexOf("/");
	const encoded = path.slice(slash + 1);
	return slash > 0 && ENCODED_ID.test(encoded) ? { lowerLabel: path.slice(0, slash), id: decodeURIComponent(encoded) } : undefined;
}
