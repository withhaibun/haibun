/**
 * The predicate registry: each predicate a line names, derived from the steppers' declarations. A step proves the
 * predicate its method names, or the one it declares, such as member_of for a domain's membership; its parts are its pattern's
 * placeholders in order, each with its domain, and its pattern is the line that states it. A step that holds rules proves the
 * predicate of each rule's head, named by the head as written, with the library that states the rule. precedes(D, A, B) holds where the order of the domain D puts A
 * before B, as `ordered set of` declares it, and a line doesn't state it.
 */
import { DOMAIN_DOMAIN_KEY, DOMAIN_VARIABLE_VALUE } from "../../domains/domains.js";
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

/** The method of a step, which names it in the registry. */
const methodOf = ({ stepperName, actionName }: TStepAction): string => stepMethodName(stepperName, actionName);

/** The name of the predicate a step proves: the predicate it declares, or its method. */
export const predicateOf = (declared: TStepAction): string => (declared.step.predicate === undefined ? methodOf(declared) : declared.step.predicate);

/** The predicates a step proves: the head of each rule it holds, or its own where it declares a pattern or an exact line. */
function stepPredicates(declared: TStepAction): TPredicate[] {
	const { step } = declared;
	const method = methodOf(declared);
	if (step.rules !== undefined) return step.rules().map(({ head, pattern, library }) => ({ name: head, parts: phraseParts(pattern), line: head, method, waypoint: library }));
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
