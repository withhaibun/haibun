/**
 * A step's arguments: each parameter resolved from its term and coerced to its domain. A term that doesn't resolve, or a
 * value its domain refuses, is a refusal that names the step, the parameter and the cause.
 */
import type { AStepper, TFeatureStep } from "../domains/stepper.js";
import type { TWorld } from "../../actuality/domains/world.js";
import type { TStepArgs, TStepValue } from "../../domains/protocol.js";
import { DOMAIN_STRING, DOMAIN_VARIABLE_VALUE, domainParts, isPrimitiveDomain, paramDomainKey, registeredDomain } from "../../domains/domains.js";
import { errorDetail } from "../../domains/util.js";

/** One parameter read: its name, the domain it takes, and its resolved value coerced to that domain. */
type TParam = { name: string; takes: string; read: TStepValue };
/** What a read of a step's parameters returns: each parameter, or the refusal of the first that doesn't read. */
type TParamsRead = { params: TParam[] } | { refused: string };
/** What a read of a step's arguments returns: the arguments, or the refusal of the first parameter that doesn't read. */
export type TArgumentsRead = { args: TStepArgs } | { refused: string };

/** Resolves a term's value, or states why it doesn't resolve. */
async function resolvedOf(inStep: string, actionVal: TStepValue, featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepValue | { refused: string }> {
	if (actionVal.value !== undefined) return actionVal;
	try {
		return await world.shared.resolveVariable(actionVal, featureStep, steppers, { secure: true });
	} catch (e) {
		return { refused: `${inStep} refuses ${actionVal.term}: ${errorDetail(e)}` };
	}
}

/** Resolves each parameter of a step and coerces it to the parameter's domain. A line's terms are resolved here, and a
 *  transport's call supplies values that are already coerced. */
async function readParams(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TParamsRead> {
	const { stepperName, actionName, stepValuesMap } = featureStep.action;
	const entries = stepValuesMap === undefined ? [] : Object.entries(stepValuesMap);
	const params: TParam[] = [];
	for (const [name, actionVal] of entries) {
		const inStep = `step ${stepperName}.${actionName}: {${name}}`;
		const resolved = await resolvedOf(inStep, actionVal, featureStep, world, steppers);
		if ("refused" in resolved) return resolved;
		if (resolved.value === undefined) {
			const reason = (await world.shared.namesAMissingField(actionVal.term))
				? await world.shared.unsetReason(actionVal.term)
				: `${actionVal.term} doesn't name a variable or an environment variable`;
			return { refused: `${inStep}: ${reason}. Quote it to pass it as a literal.` };
		}
		const takes = paramDomainKey(actionVal.domain);
		const coerced = readInDomain(inStep, takes, resolved, world, featureStep, steppers);
		if ("refused" in coerced) return coerced;
		params.push({ name, takes, read: { ...resolved, value: coerced.value } });
	}
	return { params };
}

/**
 * A step's arguments, or the refusal of the first parameter that doesn't read. A parameter whose domain is a union, or
 * `variable-value`, receives the resolved TStepValue: its value, its domain and its secret flag, since the step selects its
 * behaviour by that domain. Every other parameter receives the coerced value.
 */
export async function argumentsOf(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TArgumentsRead> {
	const read = await readParams(featureStep, world, steppers);
	if ("refused" in read) return read;
	return {
		args: Object.fromEntries(read.params.map(({ name, takes, read: value }) => [name, domainParts(takes).length > 1 || takes === DOMAIN_VARIABLE_VALUE ? value : value.value])),
	};
}

/** A step's arguments. Throws the refusal of the first parameter that doesn't read. */
export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const read = await argumentsOf(featureStep, world, steppers);
	if ("refused" in read) throw new Error(read.refused);
	return read.args;
}

/** The input a transport sends for a call: each parameter's coerced value. The receiving host resolves each value again
 *  against the step's parameter domains. Throws the refusal of the first parameter that doesn't read. */
export async function callInput(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const read = await readParams(featureStep, world, steppers);
	if ("refused" in read) throw new Error(read.refused);
	return Object.fromEntries(read.params.map(({ name, read: value }) => [name, value.value]));
}

/**
 * Coerces a resolved value to a parameter's domain. A value whose domain is the parameter's domain, or a member of its
 * union, passes unchanged, as does any value for a `string` or `variable-value` parameter: `string` doesn't name a domain
 * of a value, and the step graph's baseline records each such parameter. The parameter domain's schema coerces a
 * primitive value, and a record reference domain reads the record that the value names. Any other value is refused,
 * naming both domains.
 */
function readInDomain(
	inStep: string,
	takes: string,
	resolved: TStepValue,
	world: TWorld,
	featureStep: TFeatureStep,
	steppers: AStepper[],
): { value: unknown } | { refused: string } {
	const holds = resolved.domain;
	const parts = domainParts(takes);
	if (holds === takes || parts.includes(holds) || parts.includes(DOMAIN_STRING) || parts.includes(DOMAIN_VARIABLE_VALUE)) return { value: resolved.value };
	const domain = registeredDomain(world.domains, takes, inStep);
	if (!isPrimitiveDomain(holds) && domain.topology?.ranges?.id !== holds) return { refused: `${inStep} takes ${takes}, and ${resolved.term} holds ${holds}` };
	try {
		return { value: domain.coerce({ ...resolved, domain: takes }, featureStep, steppers) };
	} catch (e) {
		return { refused: `${inStep} takes ${takes}, and refuses ${resolved.term}: ${errorDetail(e)}` };
	}
}
