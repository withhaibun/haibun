/**
 * A line's term as the engine's text. A line, a call a transport carries and a term state one step when their terms are equal;
 * core's predicate registry parses a line to its term and renders a term as its line.
 */
import type { TLineTerm } from "@haibun/core/lib/steps/derivations/predicate-registry.js";
import { atom, list } from "./terms.js";

/** A term as the engine's text. */
export const termText = (term: TLineTerm): string =>
	`${atom(term.functor)}(${list(term.args.map(([, arg]) => `${arg.literal ? "literal" : "term"}(${atom(arg.term)})`)).slice(1, -1)})`;
