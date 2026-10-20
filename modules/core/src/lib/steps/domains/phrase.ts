/**
 * The grammar of a step's phrase: a placeholder `{name}` or `{name: domain}` names a part and the domain it takes. A
 * placeholder that doesn't name a domain takes a string.
 */
import { DOMAIN_STRING, paramDomainKey } from "../../domains/domains.js";
import { itemAt } from "../../domains/item-at.js";
import type { TStepperStep } from "./stepper.js";

/** A placeholder of a phrase, with its name and its domain inside the braces. */
const PLACEHOLDER = /\{([^}]*)\}/g;
/** The domain of a placeholder that doesn't name one. */
const UNNAMED_DOMAIN = DOMAIN_STRING;

/** A part of a phrase: a placeholder's name and the domain it takes. */
export type TPart = Readonly<{ name: string; domain: string }>;

/** A placeholder's name and domain, from the text inside its braces. */
export function placeholderOf(pair: string): TPart {
	const parts = pair.split(":").map((part) => part.trim());
	const domain = parts[1];
	return { name: itemAt(parts, 0), domain: domain === undefined || domain === "" ? UNNAMED_DOMAIN : domain };
}

/** Each phrase's parts, by its text, read once. A phrase is a step's or a rule's declaration, so the declarations bound them. */
const heldParts = new Map<string, readonly TPart[]>();

/** Each part a phrase's placeholders name, once each, in the order the phrase names them, with the key of its domain, whose
 *  union parts are in order. */
export function phraseParts(phrase: string): readonly TPart[] {
	const held = heldParts.get(phrase);
	if (held !== undefined) return held;
	const domains = new Map([...phrase.matchAll(PLACEHOLDER)].map((match) => placeholderOf(itemAt(match, 1))).map(({ name, domain }) => [name, paramDomainKey(domain)]));
	const parts = [...domains].map(([name, domain]) => ({ name, domain }));
	heldParts.set(phrase, parts);
	return parts;
}

/** A step's parts: its pattern's placeholders. A step without a pattern doesn't take a part. */
export const stepParts = (step: TStepperStep): readonly TPart[] => (step.gwta === undefined ? [] : phraseParts(step.gwta));
