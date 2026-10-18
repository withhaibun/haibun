/**
 * The grammar of a step's phrase: a placeholder `{name}` or `{name: domain}` names a parameter and the domain it takes.
 * A placeholder that doesn't name a domain takes a string.
 */
import { DOMAIN_STRING } from "../../domains/domains.js";
import { itemAt } from "../../domains/item-at.js";

/** A placeholder of a phrase, with its name and its domain inside the braces. */
const PLACEHOLDER = /\{([^}]*)\}/g;
/** The domain of a placeholder that doesn't name one. */
const UNNAMED_DOMAIN = DOMAIN_STRING;

/** A placeholder's name and domain, from the text inside its braces. */
export function placeholderOf(pair: string): { name: string; domain: string } {
	const parts = pair.split(":").map((part) => part.trim());
	const domain = parts[1];
	return { name: itemAt(parts, 0), domain: domain === undefined || domain === "" ? UNNAMED_DOMAIN : domain };
}

/** The name of each parameter a phrase's placeholders name, once each, in the order the phrase names them. */
export const phraseParameters = (phrase: string): string[] => [...new Set([...phrase.matchAll(PLACEHOLDER)].map((match) => placeholderOf(itemAt(match, 1)).name))];
