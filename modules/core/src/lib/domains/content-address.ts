/**
 * A content hash and a record's content address. The hash is the SHA-256 of a text's UTF-8 octets in base64url (RFC 4648 §5)
 * without padding. A record's content address is the RFC 6920 named-information URI of the hash of the canonical JSON (RFC 8785)
 * of its type and the values its key's fields state, so two writes of one content name one record. Both compute synchronously,
 * so a write in a page derives the same id as a write in a store.
 */
import { sha256 } from "@noble/hashes/sha2.js";

/** The scheme and the hash algorithm of a content address (RFC 6920 §3). */
const NAMED_INFORMATION_SHA256 = "ni:///sha-256;";

/** Returns the SHA-256 of a text's UTF-8 octets in unpadded base64url. */
export function contentHash(text: string): string {
	const octets = sha256(new TextEncoder().encode(text));
	return btoa(String.fromCharCode(...octets))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Returns a JSON value with each object's members in the order of their names' UTF-16 code units. ECMAScript's JSON.stringify
 *  writes strings and numbers as RFC 8785 states them, so the JSON text of the sorted value is the canonical form. */
const sorted = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(sorted)
		: typeof value === "object" && value !== null
			? Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((name) => [name, sorted((value as Record<string, unknown>)[name])]),
				)
			: value;

/** Returns the content address of a `label` record whose key's fields state `values`, in the key's order. */
export const contentAddress = (label: string, values: readonly unknown[]): string => `${NAMED_INFORMATION_SHA256}${contentHash(JSON.stringify(sorted([label, ...values])))}`;
