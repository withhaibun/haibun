import { AStepper, TFeatureStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { TStepArgs, TStepValue } from "../schema/protocol.js";
import { DOMAIN_STRING, DOMAIN_VARIABLE_VALUE, domainParts, isPrimitiveDomain, paramDomainKey, registeredDomain } from "./domains.js";
import { errorDetail } from "./util/index.js";

/** Resolves each parameter of a step and coerces it to the parameter's domain. A line's terms are resolved here, and a
 *  transport's call supplies values that are already coerced. */
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
		if (resolved.value === undefined) throw Error(`${inStep}: ${actionVal.term} doesn't name a variable or an environment variable. Quote it to pass it as a literal.`);
		const takes = paramDomainKey(actionVal.domain);
		read.push({ name, takes, read: { ...resolved, value: readInDomain(inStep, takes, resolved, world, featureStep, steppers) } });
	}
	return read;
}

/**
 * A step's arguments. A parameter whose domain is a union, or `variable-value`, receives the resolved TStepValue: its
 * value, its domain and its secret flag, since the step selects its behaviour by that domain. Every other parameter
 * receives the coerced value.
 */
export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const params = await readParams(featureStep, world, steppers);
	return Object.fromEntries(params.map(({ name, takes, read }) => [name, domainParts(takes).length > 1 || takes === DOMAIN_VARIABLE_VALUE ? read : read.value]));
}

/** The input a transport sends for a call: each parameter's coerced value. The receiving host resolves each value again
 *  against the step's parameter domains. */
export async function callInput(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const params = await readParams(featureStep, world, steppers);
	return Object.fromEntries(params.map(({ name, read }) => [name, read.value]));
}

/**
 * Coerces a resolved value to a parameter's domain. A value whose domain is the parameter's domain, or a member of its
 * union, passes unchanged, as does any value for a `string` or `variable-value` parameter: `string` doesn't name a domain
 * of a value, and the step graph's baseline records each such parameter. The parameter domain's schema coerces a
 * primitive value, and a record reference domain reads the record it refers to. Any other value is refused, naming both
 * domains.
 */
function readInDomain(inStep: string, takes: string, resolved: TStepValue, world: TWorld, featureStep: TFeatureStep, steppers: AStepper[]): unknown {
	const holds = resolved.domain;
	const parts = domainParts(takes);
	if (holds === takes || parts.includes(holds) || parts.includes(DOMAIN_STRING) || parts.includes(DOMAIN_VARIABLE_VALUE)) return resolved.value;
	const domain = registeredDomain(world.domains, takes, inStep);
	if (!isPrimitiveDomain(holds) && domain.topology?.ranges?.id !== holds) throw new Error(`${inStep} takes ${takes}, and ${resolved.term} holds ${holds}`);
	try {
		return domain.coerce({ ...resolved, domain: takes }, featureStep, steppers);
	} catch (e) {
		throw new Error(`${inStep} takes ${takes}, and refuses ${resolved.term}: ${errorDetail(e)}`);
	}
}
