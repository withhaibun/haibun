/**
 * The grammar of a step's phrase: a placeholder `{name}` or `{name: domain}` names a part and the domain it takes. A
 * placeholder that doesn't name a domain takes a string.
 */
import { DOMAIN_STRING, paramDomainKey } from "../../domains/domains.js";
import { itemAt } from "../../domains/item-at.js";
import type { TStepperStep } from "./stepper.js";

/** A placeholder of a phrase, with its name and its domain inside the braces. */
const PLACEHOLDER = /\{([^}]*)\}/g;
/** An optional group `(...)?` of a phrase: the text from the last `(` before a `)?` to that `)?`, as TOptionalGroups in
 *  stepper.ts reads it. A line that leaves the group out doesn't state the placeholders inside it. */
const OPTIONAL_GROUP = /\([^(]*?\)\?/g;
/** The domain of a placeholder that doesn't name one. */
const UNNAMED_DOMAIN = DOMAIN_STRING;

/** A part of a phrase: a placeholder's name, the domain it takes, and whether it is in an optional group, so a line may
 *  leave it out. */
export type TPart = Readonly<{ name: string; domain: string; optional: boolean }>;

/** A placeholder's name and domain, from the text inside its braces. */
export function placeholderOf(pair: string): Omit<TPart, "optional"> {
	const parts = pair.split(":").map((part) => part.trim());
	const domain = parts[1];
	return { name: itemAt(parts, 0), domain: domain === undefined || domain === "" ? UNNAMED_DOMAIN : domain };
}

/** Each phrase's parts, by its text, read once. A phrase is a step's or a rule's declaration, so the declarations bound them. */
const heldParts = new Map<string, readonly TPart[]>();

/**
 * Each part a phrase's placeholders name, once each, in the order the phrase names them, with the key of its domain, whose
 * union parts are in order. A part is optional where the phrase names it inside an optional group. This is the one reading
 * of a phrase: dispatch, the input schema a step publishes and withAction read it, and TArgsOf in stepper.ts types the same
 * reading.
 */
export function phraseParts(phrase: string): readonly TPart[] {
	const held = heldParts.get(phrase);
	if (held !== undefined) return held;
	const groups = [...phrase.matchAll(OPTIONAL_GROUP)].map((group) => ({ start: group.index, end: group.index + group[0].length }));
	const parts = new Map<string, TPart>();
	for (const match of phrase.matchAll(PLACEHOLDER)) {
		const { name, domain } = placeholderOf(itemAt(match, 1));
		const optional = parts.get(name)?.optional === true || groups.some(({ start, end }) => match.index > start && match.index < end);
		parts.set(name, { name, domain: paramDomainKey(domain), optional });
	}
	const read = [...parts.values()];
	heldParts.set(phrase, read);
	return read;
}

/** The names of the parts every line of a phrase states: those outside its optional groups. */
export const requiredNames = (parts: readonly TPart[]): string[] => parts.flatMap(({ name, optional }) => (optional ? [] : [name]));

/** A step's parts: its pattern's placeholders. A step without a pattern doesn't take a part. */
export const stepParts = (step: TStepperStep): readonly TPart[] => (step.gwta === undefined ? [] : phraseParts(step.gwta));
