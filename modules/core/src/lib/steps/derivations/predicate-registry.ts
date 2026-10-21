/**
 * The predicate registry: each predicate a line and a formula name, derived from the steppers' declarations. A step proves the
 * predicate its method names, or the one it declares, such as member_of for a domain's membership; its parts are its pattern's
 * placeholders in order, each with its domain, and its pattern is the line that states it. A step that holds rules proves the
 * predicate of each rule's head, named by the head as written. precedes(D, A, B) holds where the order of the domain D puts A
 * before B, as `ordered set of` declares it, and a line doesn't state it. A record states the predicates of its persisted type
 * and of the fields the type's topology declares, which the graph's TPTP axioms state.
 */
import { DOMAIN_DOMAIN_KEY, DOMAIN_VARIABLE_VALUE } from "../../domains/domains.js";
import { isPersisted, type TRegisteredDomain } from "../../domains/resources.js";
import { constructorName } from "../../domains/util.js";
import { PREDICATE, type AStepper, type TStepAction } from "../domains/stepper.js";
import { stepMethodName } from "../domains/step-method.js";
import { phraseParts, stepParts, type TPart } from "../domains/phrase.js";
import type { TPredicate } from "../domains/step-discovery.js";

/** A part that takes a member of a domain. */
const member = (name: string): TPart => ({ name, domain: DOMAIN_VARIABLE_VALUE });
const PRECEDES: TPredicate = { name: PREDICATE.precedes, parts: [{ name: "domain", domain: DOMAIN_DOMAIN_KEY }, member("before"), member("after")] };

/** Each step of the steppers, by its stepper's name and its own name. */
export const declaredSteps = (steppers: readonly AStepper[]): TStepAction[] =>
	steppers.flatMap((stepper) => Object.entries(stepper.steps).map(([actionName, step]) => ({ stepperName: constructorName(stepper), actionName, step })));

/** The name of the predicate a step proves: the predicate it declares, or its method. */
export const predicateOf = ({ stepperName, actionName, step }: TStepAction): string => (step.predicate === undefined ? stepMethodName(stepperName, actionName) : step.predicate);

/** The predicates a step proves: the head of each rule it holds, or its own where it declares a pattern or an exact line. */
function stepPredicates(declared: TStepAction): TPredicate[] {
	const { step } = declared;
	const method = stepMethodName(declared.stepperName, declared.actionName);
	if (step.rules !== undefined) return step.rules().map(({ head, pattern }) => ({ name: head, parts: phraseParts(pattern), line: head, method }));
	const line = step.gwta === undefined ? step.exact : step.gwta;
	return line === undefined ? [] : [{ name: predicateOf(declared), parts: stepParts(step), line, method }];
}

/** The predicates of the registry: each step's and each rule head's, and precedes. */
export const predicatesOf = (steps: readonly TStepAction[]): TPredicate[] => [...steps.flatMap(stepPredicates), PRECEDES];

/** The arity of each predicate a record states, as the graph's axioms state it: a persisted type over its record, and each
 *  property and edge the type's topology declares over the record and its value. */
const recordArities = (domains: Record<string, TRegisteredDomain>): [string, number][] =>
	Object.values(domains).flatMap(({ topology }) =>
		isPersisted(topology) ? [[topology.persistedAs, 1], ...Object.keys({ ...topology.properties, ...topology.edges }).map((field): [string, number] => [field, 2])] : [],
	);

/** The registry's predicates by name, with their arity, which a formula's predicates are held to: the records' and the steps'. */
export const predicateArities = (steppers: readonly AStepper[], domains: Record<string, TRegisteredDomain>): Map<string, number> =>
	new Map([...recordArities(domains), ...predicatesOf(declaredSteps(steppers)).map(({ name, parts }): [string, number] => [name, parts.length])]);
