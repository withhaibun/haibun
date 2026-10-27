/**
 * Writes the axioms of a class, a property and an individual in Manchester syntax (W3C Note) and in DL notation. A union is
 * `or` and ⊔, an intersection of superclasses is `,` and ⊓, a domain is ∃p.⊤ ⊑ D and a range is ⊤ ⊑ ∀p.R. A name that
 * Manchester syntax doesn't read as written, such as one with a space, is an IRI in angle brackets.
 */
import { FRAME_KIND } from "../domains/axioms.js";

/** A frame's axioms: its Manchester syntax and its DL notation. */
export type TAxioms = { manchester: string; dl: string };
/** A fact of an individual: its property, and its value as an individual or as a literal. */
export type TIndividualFact = { property: string; value: string | number | boolean; individual: boolean };

const WRITTEN_NAME = /^(?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*$/;
const SECTION = "\n    ";
const BETWEEN_AXIOMS = " · ";
const TOP = "⊤";

/** A name as Manchester syntax and DL notation write it. */
export const manchesterName = (name: string): string => (WRITTEN_NAME.test(name) ? name : `<${encodeURI(name)}>`);
const literal = (value: string | number | boolean): string => (typeof value === "string" ? JSON.stringify(value) : String(value));
const sections = (head: string, parts: [string, string[]][]): string =>
	[head, ...parts.flatMap(([label, items]) => (items.length === 0 ? [] : [`${label}: ${items.join(", ")}`]))].join(SECTION);
/** A union in DL notation, in parentheses where it joins more than one class. */
const union = (classes: readonly string[]): string => (classes.length === 1 ? classes.join("") : `(${classes.join(" ⊔ ")})`);

/** A class's axioms: each superclass it is subsumed by, or ⊤ where it doesn't state one. */
export function classAxioms(name: string, superclasses: readonly string[]): TAxioms {
	const [named, supers] = [manchesterName(name), superclasses.map(manchesterName)];
	return { manchester: sections(`${FRAME_KIND.class}: ${named}`, [["SubClassOf", supers]]), dl: `${named} ⊑ ${supers.length === 0 ? TOP : supers.join(" ⊓ ")}` };
}

/** A property's axioms: the union of the classes that declare it as its domain, the union of the classes it reaches as its
 *  range, and each of its superproperties. */
export function propertyAxioms(name: string, domain: readonly string[], range: readonly string[], superProperties: readonly string[]): TAxioms {
	const [named, domains, ranges, supers] = [manchesterName(name), domain.map(manchesterName), range.map(manchesterName), superProperties.map(manchesterName)];
	const dl = [
		...(domains.length === 0 ? [] : [`∃${named}.${TOP} ⊑ ${union(domains)}`]),
		...(ranges.length === 0 ? [] : [`${TOP} ⊑ ∀${named}.${union(ranges)}`]),
		...supers.map((parent) => `${named} ⊑ ${parent}`),
	];
	const manchester = sections(`${FRAME_KIND.property}: ${named}`, [
		["Domain", domains.length === 0 ? [] : [domains.join(" or ")]],
		["Range", ranges.length === 0 ? [] : [ranges.join(" or ")]],
		["SubPropertyOf", supers],
	]);
	return { manchester, dl: dl.length === 0 ? named : dl.join(BETWEEN_AXIOMS) };
}

/** An individual's axioms: each class it is a member of, and each fact it states. */
export function individualAxioms(name: string, types: readonly string[], facts: readonly TIndividualFact[]): TAxioms {
	const named = manchesterName(name);
	const objectOf = ({ value, individual }: TIndividualFact): string => (individual ? manchesterName(String(value)) : literal(value));
	const manchester = sections(`${FRAME_KIND.individual}: ${named}`, [
		["Types", types.map(manchesterName)],
		["Facts", facts.map((fact) => `${manchesterName(fact.property)} ${objectOf(fact)}`)],
	]);
	const dl = [...types.map((type) => `${manchesterName(type)}(${named})`), ...facts.map((fact) => `${manchesterName(fact.property)}(${named}, ${objectOf(fact)})`)];
	return { manchester, dl: dl.join(BETWEEN_AXIOMS) };
}
