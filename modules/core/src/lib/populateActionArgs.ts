import { AStepper, TFeatureStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { TStepArgs, TStepValue } from "../schema/protocol.js";
import { DOMAIN_STRING, DOMAIN_VARIABLE_VALUE, domainParts, isPrimitiveDomain, paramDomainKey } from "./domains.js";
import { errorDetail } from "./util/index.js";

/** Each parameter's value as its domain reads it, with the domain it holds: resolved from the line, or carried by a
 *  transport's call, which arrives with its values read already. */
async function readParams(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<Array<{ name: string; takes: string; read: TStepValue }>> {
	const params = Object.entries(featureStep?.action?.stepValuesMap ?? {});
	const { stepperName, actionName } = featureStep.action ?? {};
	const read: Array<{ name: string; takes: string; read: TStepValue }> = [];
	for (const [name, actionVal] of params) {
		const inStep = `step ${stepperName}.${actionName}: {${name}}`;
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
		const takes = paramDomainKey(actionVal.domain);
		read.push({ name, takes, read: { ...resolved, value: readInDomain(inStep, takes, resolved, world, featureStep, steppers) } });
	}
	return read;
}

/**
 * A step's arguments. A parameter taking more than one domain receives the value with the domain it holds, since that
 * decides how the step reads it: a union takes each of its parts, and `variable-value` takes any domain, which the domain
 * of the variable it is set to or compared with reads.
 */
export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const params = await readParams(featureStep, world, steppers);
	return Object.fromEntries(params.map(({ name, takes, read }) => [name, domainParts(takes).length > 1 || takes === DOMAIN_VARIABLE_VALUE ? read : read.value]));
}

/** A call's input as a transport sends it: each parameter's value as its domain reads it, which the far side reads again
 *  by the step's own parameters. */
export async function callInput(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const params = await readParams(featureStep, world, steppers);
	return Object.fromEntries(params.map(({ name, read }) => [name, read.value]));
}

/**
 * A value of the parameter's domain, or of a part of a union it takes, is as it is, as is any value a `string` or
 * `variable-value` parameter takes: `string` doesn't name a domain of what a value is, and the step graph's baseline
 * records each such parameter. A primitive value, and an individual where the domain is a reference to one, is read by
 * the domain's schema. A value of any other domain is refused, naming both.
 */
function readInDomain(inStep: string, takes: string, resolved: TStepValue, world: TWorld, featureStep: TFeatureStep, steppers: AStepper[]): unknown {
	const holds = resolved.domain;
	const parts = domainParts(takes);
	if (holds === takes || parts.includes(holds) || parts.includes(DOMAIN_STRING) || parts.includes(DOMAIN_VARIABLE_VALUE)) return resolved.value;
	const domain = world.domains[takes];
	if (!domain) throw new Error(`${inStep} takes the domain "${takes}", which no loaded stepper registers`);
	if (!isPrimitiveDomain(holds) && domain.topology?.ranges?.id !== holds) throw new Error(`${inStep} takes ${takes}, and ${resolved.term} holds ${holds}`);
	try {
		return domain.coerce({ ...resolved, domain: takes }, featureStep, steppers);
	} catch (e) {
		throw new Error(`${inStep} takes ${takes}, and refuses ${resolved.term}: ${errorDetail(e)}`);
	}
}
