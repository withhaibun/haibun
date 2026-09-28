/**
 * A step's line as the one renderer states it. Every step core and web-playwright register renders, from a literal term
 * for each parameter, a line the resolver resolves back to that step with those terms, so the record of a call a
 * transport carries is a line that runs.
 */
import { describe, it, expect } from "vitest";
import { Resolver } from "@haibun/core/phases/Resolver.js";
import { createSteppers } from "@haibun/core/lib/util/index.js";
import { literalTerm, namedInterpolation, renderStepLine } from "@haibun/core/lib/namedVars.js";
import { DOMAIN_JSON, DOMAIN_NUMBER, DOMAIN_STATEMENT, domainParts } from "@haibun/core/lib/domains.js";
import type { AStepper } from "@haibun/core/lib/astepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import LogicStepper from "@haibun/core/steps/logic-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import BlipsStepper from "@haibun/core/steps/blips-stepper.js";
import GoalResolutionStepper from "@haibun/core/steps/goal-resolution-stepper.js";
import UrakataStepper from "@haibun/core/steps/urakata-stepper.js";
import WebPlaywright from "./web-playwright.js";

const steppers = createSteppers([
	Haibun,
	VariablesStepper,
	LogicStepper,
	ResourcesStepper,
	AuthorityStepper,
	ActivitiesStepper,
	BlipsStepper,
	GoalResolutionStepper,
	UrakataStepper,
	WebPlaywright,
]);
const resolver = new Resolver(steppers);

/** A step's parameters, by name, with the domain each takes. */
const paramsOf = (gwta: string): Array<[string, string | undefined]> =>
	Object.entries(namedInterpolation(gwta.replace(/\([^)]*\)\?/g, "")).stepValuesMap ?? {}).map(([name, value]) => [name, value.domain]);

/** The line of a step that doesn't take a parameter, which a statement parameter is given. */
const STATEMENT = "page has settled";

/** A literal term for a parameter of `domain`: a number or a composite where the domain takes one, a statement line,
 *  else text. */
const termFor = (name: string, domain: string | undefined): string => {
	if (domain && domainParts(domain).includes(DOMAIN_NUMBER)) return literalTerm(7, domain);
	if (domain === DOMAIN_JSON) return literalTerm({ [name]: 7 }, domain);
	if (domain === DOMAIN_STATEMENT) return literalTerm(STATEMENT, domain);
	return literalTerm(`a ${name}`, domain);
};

const rendered = (steppers as AStepper[]).flatMap((stepper) =>
	Object.entries(stepper.steps)
		.filter(([, step]) => typeof step.gwta === "string")
		.map(([stepName, step]) => {
			const terms = Object.fromEntries(paramsOf(step.gwta as string).map(([name, domain]) => [name, termFor(name, domain)]));
			return { stepperName: stepper.constructor.name, stepName, terms, line: renderStepLine(step.gwta as string, terms) };
		}),
);

describe("a step's line, as the one renderer states it", () => {
	it("resolves a statement a statement parameter is given", () => {
		expect(resolver.findSingleStepAction(STATEMENT).actionName).toBe("pageHasSettled");
	});

	it.each(rendered)("$stepperName.$stepName resolves back from $line", ({ stepperName, stepName, terms, line }) => {
		const action = resolver.findSingleStepAction(line);
		expect(`${action.stepperName}.${action.actionName}`).toBe(`${stepperName}.${stepName}`);
		const captured = Object.fromEntries(Object.entries(action.stepValuesMap ?? {}).map(([name, value]) => [name, value.term]));
		expect(captured).toEqual(Object.fromEntries(Object.entries(terms).map(([name, term]) => [name, term.replace(/^"(.*)"$/s, "$1")])));
	});
});
