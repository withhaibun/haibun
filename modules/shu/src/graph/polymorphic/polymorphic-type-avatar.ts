/**
 * A node's type avatar: the initials of its @type, so a reader tells a Principal from a Person, or a SpecificResource
 * from its selector, without reading the label or learning the colours.
 *
 * Derived from the type name: the initial of each word, taking CamelCase segments and separator-delimited parts alike
 * (SpecificResource → SR, Principal → P, observation/http-request → OHR). A new type needs no registration: there is no
 * list to append to and nothing to keep in step with the schema.
 */

/** Initials kept, so a long type name cannot stretch the avatar past a glanceable badge. */
export const AVATAR_MAX_CHARS = 3;

/** Words in a type name: a run of capitals not starting a word (URL in URLThing), a capitalised word, or a lowercase run. */
const TYPE_WORDS = /[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+/g;

export function typeAvatar(type: string): string {
	return (type.match(TYPE_WORDS) ?? [])
		.map((word) => word[0].toUpperCase())
		.join("")
		.slice(0, AVATAR_MAX_CHARS);
}
