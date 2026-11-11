/**
 * The predicate registry: each predicate a line names, derived from the steppers' declarations. A step proves the
 * predicate its method names, or the one it declares, such as member_of for a domain's membership; its parts are its pattern's
 * placeholders in order, each with its domain, and its pattern is the line that states it. A step that holds rules proves the
 * predicate of each rule's head, named by the head as written, with the library that states the rule. precedes(D, A, B) holds where the order of the domain D puts A
 * before B, as `ordered set of` declares it, and a line doesn't state it.
 *
 * A term's line renders through its pattern, and a line parses back to the same term. A contract statement's term is its
 * relation's name, with `¬` before a negation, and its sentence is the relation's phrase for a statement that holds or one that
 * doesn't, with each argument stated by its term.
 */
import { DOMAIN_DOMAIN_KEY, DOMAIN_VARIABLE_VALUE } from "../../domains/domains.js";
import { Origin, type TStepValue } from "../../domains/protocol.js";
import type { TRegisteredDomain } from "../../domains/resources.js";
import { itemAt } from "../../domains/item-at.js";
import { constructorName } from "../../domains/util.js";
import { PREDICATE, type AStepper, type TStepAction } from "../domains/stepper.js";
import { stepMethodName } from "../domains/step-method.js";
import { phraseParts, stepParts, type TPart } from "../domains/phrase.js";
import type { TPredicate } from "../domains/step-discovery.js";
import { argumentTerm, NEGATED_PLACE, NEGATION_GWTA, type TRelation, type TStatement } from "../domains/contract.js";
import { literalTerm, phraseValues, renderStepLine } from "./named-vars.js";

/** A part that takes a member of a domain. */
const member = (name: string): TPart => ({ name, domain: DOMAIN_VARIABLE_VALUE });
const PRECEDES: TPredicate = { name: PREDICATE.precedes, parts: [{ name: "domain", domain: DOMAIN_DOMAIN_KEY }, member("before"), member("after")] };

/** Each step of the steppers, by its stepper's name and its own name. */
export const declaredSteps = (steppers: readonly AStepper[]): TStepAction[] =>
	steppers.flatMap((stepper) => Object.entries(stepper.steps).map(([actionName, step]) => ({ stepperName: constructorName(stepper), actionName, step })));

/** The method of a step, which names it in the registry. */
const methodOf = ({ stepperName, actionName }: TStepAction): string => stepMethodName(stepperName, actionName);

/** The name of the predicate a step proves: the predicate it declares, or its method. */
export const predicateOf = (declared: TStepAction): string => (declared.step.predicate === undefined ? methodOf(declared) : declared.step.predicate);

/** The predicates a step proves: the head of each rule it holds, or its own where it declares a pattern or an exact line. */
function stepPredicates(declared: TStepAction): TPredicate[] {
	const { step } = declared;
	const method = methodOf(declared);
	if (step.rules !== undefined)
		return step.rules().map(({ head, pattern, library, description }) => ({ name: head, parts: phraseParts(pattern), line: head, method, waypoint: library, description }));
	const line = step.gwta === undefined ? step.exact : step.gwta;
	return line === undefined ? [] : [{ name: predicateOf(declared), parts: stepParts(step), line, method }];
}

/** The predicates of the registry: each step's and each rule head's, and precedes. Throws where two steps declare one predicate,
 *  such as member_of, and names both. */
export function predicatesOf(steps: readonly TStepAction[]): TPredicate[] {
	const declaring = steps.filter(({ step }) => step.predicate !== undefined);
	for (const [name, both] of Map.groupBy(declaring, predicateOf))
		if (both.length > 1) throw new Error(`${both.map(methodOf).join(" and ")} each declare the predicate ${name}; declare it on one step`);
	return [...steps.flatMap(stepPredicates), PRECEDES];
}

/** An argument of a line's term: a literal the line states, or a term the line resolves, such as a variable's name. */
type TTermArg = { literal: boolean; term: string };
/** A line's term: the method of its step and each argument by the name its pattern gives it, in the pattern's order. */
export type TLineTerm = { functor: string; args: [string, TTermArg][] };

type TDomains = Readonly<Record<string, TRegisteredDomain>>;

/** Whether a value is a literal: quoted, or of a domain whose term is written as it stands, such as a variable's name. */
const isLiteral = (value: TStepValue, domains: TDomains): boolean => value.origin === Origin.quoted || domains[value.domain]?.written === true;

/** The term of a resolved line or of a call a transport built, named by the predicate its step proves, with each argument in its
 *  pattern's order. */
export function termOfAction(functor: string, values: Record<string, TStepValue> | undefined, gwta: string, domains: TDomains): TLineTerm {
	return {
		functor,
		args: phraseParts(gwta).map(({ name }) => {
			const value = values?.[name];
			if (value === undefined) throw new Error(`A line of the pattern \`${gwta}\` doesn't state {${name}}. State a value for {${name}} in the line.`);
			return [name, { literal: isLiteral(value, domains), term: value.term }];
		}),
	};
}

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

/** The mark before the functor of a negated statement's term. */
const NEGATION = "¬";
/** A statement's sentence states its arguments as the terms a declaration names them by, so it doesn't read a domain's form. */
const SENTENCE_DOMAINS: TDomains = {};

/** A statement's term: its relation's name, with `¬` before a negation, and each argument's term by the place of the relation's
 *  phrase it fills. */
export function statementTerm({ relation, args, negated }: TStatement): TLineTerm {
	const places = phraseParts(relation.phrase);
	if (places.length !== args.length) throw new Error(`${relation.name} takes ${places.length} arguments, and the statement gives ${args.length}`);
	return { functor: `${negated ? NEGATION : ""}${relation.name}`, args: places.map(({ name }, at) => [name, { literal: false, term: argumentTerm(itemAt(args, at)) }]) };
}

/** The sentence a statement renders as: its relation's phrase, inside the `didn't` combinator where the statement is negated. */
export function statementSentence(statement: TStatement): string {
	const held = lineOfTerm(statement.relation.phrase, statementTerm(statement), SENTENCE_DOMAINS);
	return statement.negated ? renderStepLine(NEGATION_GWTA, { [NEGATED_PLACE]: held }) : held;
}

/** The term of the statement a sentence states through the first of `relations`' phrases that parses it, read inside the
 *  `didn't` combinator where the sentence states a negation, or undefined where each phrase refuses it. */
export function sentenceTerm(relations: Iterable<TRelation>, sentence: string): TLineTerm | undefined {
	const negation = phraseValues(NEGATION_GWTA, sentence)?.[NEGATED_PLACE];
	const stated = negation === undefined ? sentence : negation.term;
	for (const { name, phrase } of relations) {
		const values = phraseValues(phrase, stated);
		if (values !== undefined) return termOfAction(`${negation === undefined ? "" : NEGATION}${name}`, values, phrase, SENTENCE_DOMAINS);
	}
	return undefined;
}
