/** Values as EYE holds them in Prolog, which a session's rows and a translated check's facts take. */
import type { Term } from "@rdfjs/types";
import { XSD } from "@haibun/core/lib/domains/vocabularies.js";
import type { TReasonerValue } from "./reasoning.js";

/** The datatypes EYE holds as Prolog numbers and booleans, in place of `literal/2`. */
const NATIVE: ReadonlySet<string> = new Set([XSD.integer, XSD.decimal, XSD.boolean]);
const quotedAtom = (text: string): string => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Whether a value is an IRI or a literal, rather than a string, a number or a list. */
const isTerm = (value: TReasonerValue): value is Term => typeof value === "object" && "termType" in value;

/** Returns a value as EYE holds it in Prolog: an IRI as a quoted atom in angle brackets, a number or a boolean as itself, a list
 *  as a list, and another literal or a string as `literal/2` with its language or datatype. */
export function prologOf(value: TReasonerValue): string {
	if (typeof value === "number") return String(value);
	if (typeof value === "string") return `literal(${quotedAtom(value)}, type(${quotedAtom(`<${XSD.string}>`)}))`;
	if (!isTerm(value)) return `[${value.map(prologOf).join(", ")}]`;
	if (value.termType === "NamedNode") return quotedAtom(`<${value.value}>`);
	if (value.termType !== "Literal") throw new Error(`a value ${value.value} the host returned is a ${value.termType}, and a session reads a named node or a literal.`);
	if (NATIVE.has(value.datatype.value)) return value.value;
	const text = quotedAtom(value.value);
	if (value.language !== "") return `literal(${text}, lang(${quotedAtom(value.language)}))`;
	return `literal(${text}, type(${quotedAtom(`<${value.datatype.value}>`)}))`;
}

/** Returns a term of a fact as a translated check holds it: a blank node as a constant by its label, and any other term as EYE holds it. */
export const factTermOf = (term: Term): string => (term.termType === "BlankNode" ? quotedAtom(`_:${term.value}`) : prologOf(term));
