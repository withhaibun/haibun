import { AStepper, TFeatureStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { TStepArgs, TStepValue } from "../schema/protocol.js";
import { DOMAIN_STRING, DOMAIN_VARIABLE_VALUE, domainParts, isPrimitiveDomain, paramDomainKey } from "./domains.js";
import { errorDetail } from "./util/index.js";

export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs;
	const { stepperName, actionName } = featureStep.action;

	for (const [name, actionVal] of Object.entries(featureStep.action.stepValuesMap)) {
		const inStep = `step ${stepperName}.${actionName}: {${name}}`;
		// A transport's call arrives with its values read already; a line's values are resolved here.
		const resolved =
			actionVal.value !== undefined
				? actionVal
				: await world.shared.resolveVariable(actionVal, featureStep, steppers, { secure: true }).catch((e: unknown) => {
						throw new Error(`${inStep} refuses ${actionVal.term}: ${errorDetail(e)}`);
					});
		if (resolved.value === undefined) {
			const handlesUndefined = featureStep.action.step.handlesUndefined;
			if (handlesUndefined === true || handlesUndefined?.includes(name)) continue;
			throw Error(`${inStep}: ${actionVal.term} isn't a variable, and a value the line writes is quoted`);
		}
		stepArgs[name] = inParamDomain(inStep, paramDomainKey(actionVal.domain), resolved, world, featureStep, steppers);
	}
	return stepArgs;
}

/**
 * A resolved value as its parameter's domain takes it. A value of that domain, or of a part of a union it takes, is as it
 * is, as is any value a `string` parameter takes: `string` doesn't name a domain of what a value is, and the step graph's
 * baseline records each such parameter. A `variable-value` parameter takes the resolved value whole: its value, its domain
 * and whether it is secret, since the domain of the variable it is set to or compared with reads it. A primitive value,
 * and an individual where the domain is a reference to one, is read by the domain's schema. A value of any other domain is
 * refused, naming both.
 */
function inParamDomain(inStep: string, takes: string, resolved: TStepValue, world: TWorld, featureStep: TFeatureStep, steppers: AStepper[]): unknown {
	const holds = resolved.domain;
	const parts = domainParts(takes);
	if (parts.includes(DOMAIN_VARIABLE_VALUE)) return resolved;
	if (holds === takes || parts.includes(holds) || parts.includes(DOMAIN_STRING)) return resolved.value;
	const domain = world.domains[takes];
	if (!domain) throw new Error(`${inStep} takes the domain "${takes}", which no loaded stepper registers`);
	if (!isPrimitiveDomain(holds) && domain.topology?.ranges?.id !== holds) throw new Error(`${inStep} takes ${takes}, and ${resolved.term} holds ${holds}`);
	try {
		return domain.coerce({ ...resolved, domain: takes }, featureStep, steppers);
	} catch (e) {
		throw new Error(`${inStep} takes ${takes}, and refuses ${resolved.term}: ${errorDetail(e)}`);
	}
}
