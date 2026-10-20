/**
 * The predicate registry's faces of a step: the term a resolved line parses to, named by the predicate the step proves, the
 * term's text, the line a term renders as through the step's pattern, and a waypoint's rule as a TPTP axiom over the terms of
 * its proof. A line, a call a transport carries and a term state one step when their terms are equal.
 */
import { literalTerm, renderStepLine } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { Origin, type TStepValue } from "@haibun/core/lib/domains/protocol.js";
import { phraseParts } from "@haibun/core/lib/steps/domains/phrase.js";
import { ruleStatedAt, type TWaypointRule } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { atom, list } from "./terms.js";
import { conjunction, constantOf, literalOf, nameOfText, variableAt, type TFormula, type TTerm } from "./formula.js";
import type { TStatedFormula } from "./term-graph.js";

/** An argument of a line's term: a literal the line states, or a term the line resolves, such as a variable's name. */
type TTermArg = { literal: boolean; term: string };
/** A line's term: the method of its step and each argument by the name its pattern gives it, in the pattern's order. */
export type TLineTerm = { functor: string; args: [string, TTermArg][] };

type TDomains = Record<string, TRegisteredDomain>;

/** Whether a value is a literal: quoted, or of a domain whose term is written as it stands, such as a variable's name. */
const isLiteral = (value: TStepValue, domains: TDomains): boolean => value.origin === Origin.quoted || domains[value.domain]?.written === true;

/** The term of a resolved line or of a call a transport built, named by the predicate its step proves, with each argument in its
 *  pattern's order. */
export function termOfAction(functor: string, values: Record<string, TStepValue> | undefined, gwta: string, domains: TDomains): TLineTerm {
	return {
		functor,
		args: phraseParts(gwta).map(({ name }) => {
			const value = values?.[name];
			if (value === undefined) throw new Error(`the line of ${functor} doesn't state {${name}}, which its pattern names`);
			return [name, { literal: isLiteral(value, domains), term: value.term }];
		}),
	};
}

/** A term as the engine's text. */
export const termText = (term: TLineTerm): string =>
	`${atom(term.functor)}(${list(term.args.map(([, arg]) => `${arg.literal ? "literal" : "term"}(${atom(arg.term)})`)).slice(1, -1)})`;

/** The line a term renders as: a literal of a domain that isn't written as it stands is quoted, and every other term is stated as it is. */
export function lineOfTerm(gwta: string, term: TLineTerm, domains: TDomains): string {
	const parts = new Map(phraseParts(gwta).map(({ name, domain }) => [name, domain]));
	const stated = term.args.map(([name, arg]): [string, string] => {
		const domain = parts.get(name);
		const written = domain !== undefined && domains[domain]?.written === true;
		return [name, arg.literal && !written ? literalTerm(arg.term, domain) : arg.term];
	});
	return renderStepLine(gwta, Object.fromEntries(stated));
}

/**
 * A waypoint's rule as a TPTP axiom: its head holds where each line of its proof holds. The head is a predicate named by the head
 * as written, over a variable for each placeholder of its pattern. Each line of the proof is the atom of its term, whose predicate
 * is the term's functor and in which an argument that states a placeholder of the head is that placeholder's variable. It states
 * the waypoint's line and where it is stated. Throws for a rule without a proof, which states its head only where its activity ran.
 */
export function waypointAxiom(name: string, rule: TWaypointRule, proof: readonly TLineTerm[]): TStatedFormula {
	const placeholders = phraseParts(rule.pattern).map(({ name }) => name);
	const variables = placeholders.map((_, at) => variableAt(at));
	const argOf = ({ literal, term }: TTermArg): TTerm => {
		const at = placeholders.findIndex((placeholder) => term === `{${placeholder}}`);
		return at >= 0 ? { variable: variableAt(at) } : literal ? literalOf(term) : constantOf(term);
	};
	const body = conjunction(proof.map(({ functor, args }) => ({ atom: nameOfText(functor), args: args.map(([, arg]) => argOf(arg)) })));
	const implication: TFormula = { connective: "=>", left: body, right: { atom: nameOfText(rule.head), args: variables.map((variable) => ({ variable })) } };
	const statement = `waypoint ${rule.head} with ${rule.proof.map((line) => line.in).join(", ")} (${ruleStatedAt(rule)})`;
	return { name, role: "axiom", formula: variables.length === 0 ? implication : { quantifier: "!", variables, body: implication }, statement };
}
