import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld } from './defs.js';
import { DOMAIN_STRING, normalizeDomainKey } from './domain-types.js';
import { resolveVariable } from './util/variables.js';

// Given a feature step and the current world, populate the action args. This will update the existing stepValuesMap as actionVal
export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs; // no variables for this step

	for (const [name, actionVal] of Object.entries(featureStep.action.stepValuesMap)) {
		resolveVariable(actionVal, world);
		if (actionVal.value === undefined) {
			continue;
		}

		const actionDomainKey = normalizeDomainKey(actionVal.domain || DOMAIN_STRING);
		if (!world.domains[actionDomainKey]) {
			throw new Error(`No domain coercer found for domain "${actionDomainKey}"`);
		}

		actionVal.domain = actionDomainKey;
		actionVal.value = await Promise.resolve(world.domains[actionDomainKey].coerce(actionVal, featureStep, steppers));

		// actionVal has been updated, update the actionVal in place for downstream processing
		stepArgs[name] = actionVal.value;
	}
	if (Object.keys(featureStep.action.stepValuesMap).length > 0 && Object.keys(stepArgs).length === 0) {
		console.log('DEBUG populateActionArgs: empty args but map has keys', featureStep.action.stepValuesMap);
	}
	return stepArgs;
}
