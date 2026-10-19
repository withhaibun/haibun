/**
 * The predicate registry's faces of a step: the term a resolved line parses to, the term's text, and the line a term
 * renders as through the step's pattern. A line, a call a transport carries and a term state one step when their terms
 * are equal.
 */
import { literalTerm, namedInterpolation, renderStepLine } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { Origin, type TStepValue } from "@haibun/core/lib/domains/protocol.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import type { AStepper, TStepAction } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { atom, list } from "./terms.js";

/** An argument of a line's term: a literal the line states, or a term the line resolves, such as a variable's name. */
type TTermArg = { literal: boolean; term: string };
/** A line's term: the method of its step and each argument by the name its pattern gives it, in the pattern's order. */
export type TLineTerm = { functor: string; args: [string, TTermArg][] };

type TDomains = Record<string, TRegisteredDomain>;

/** Whether a value is a literal: quoted, or of a domain whose term is written as it stands, such as a variable's name. */
const isLiteral = (value: TStepValue, domains: TDomains): boolean => value.origin === Origin.quoted || domains[value.domain]?.written === true;

/** The term of a resolved line or of a call a transport built, with each argument in its pattern's order. */
export function termOfAction(action: Pick<TStepAction, "stepperName" | "actionName" | "stepValuesMap">, gwta: string, domains: TDomains): TLineTerm {
	const placeholders = namedInterpolation(gwta).stepValuesMap;
	const names = placeholders === undefined ? [] : Object.keys(placeholders);
	const values = action.stepValuesMap;
	if (values === undefined && names.length > 0) throw new Error(`${action.stepperName}.${action.actionName} doesn't state the values its pattern names`);
	return {
		functor: stepMethodName(action.stepperName, action.actionName),
		args: names.map((name) => {
			const value = values?.[name];
			if (value === undefined) throw new Error(`${action.stepperName}.${action.actionName} doesn't state {${name}}, which its pattern names`);
			return [name, { literal: isLiteral(value, domains), term: value.term }];
		}),
	};
}

/** The registry's predicates: each step's method by name, with the number of placeholders its pattern names as its arity. */
export function registryPredicates(steppers: readonly AStepper[], nameOf: (stepper: AStepper) => string): Map<string, number> {
	return new Map(
		steppers.flatMap((stepper) =>
			Object.entries(stepper.steps).flatMap(([actionName, step]) => {
				const pattern = step.gwta === undefined ? step.exact : step.gwta;
				if (pattern === undefined) return [];
				const placeholders = namedInterpolation(pattern).stepValuesMap;
				return [[stepMethodName(nameOf(stepper), actionName), placeholders === undefined ? 0 : Object.keys(placeholders).length] as const];
			}),
		),
	);
}

/** A term as the engine's text. */
export const termText = (term: TLineTerm): string =>
	`${atom(term.functor)}(${list(term.args.map(([, arg]) => `${arg.literal ? "literal" : "term"}(${atom(arg.term)})`)).slice(1, -1)})`;

/** The line a term renders as: a literal of a domain that isn't written as it stands is quoted, and every other term is stated as it is. */
export function lineOfTerm(gwta: string, term: TLineTerm, domains: TDomains): string {
	const placeholders = namedInterpolation(gwta).stepValuesMap;
	const stated = term.args.map(([name, arg]): [string, string] => {
		const domain = placeholders?.[name]?.domain;
		const written = domain !== undefined && domains[domain]?.written === true;
		return [name, arg.literal && !written ? literalTerm(arg.term, domain) : arg.term];
	});
	return renderStepLine(gwta, Object.fromEntries(stated));
}
