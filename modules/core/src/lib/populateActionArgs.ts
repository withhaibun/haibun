import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld, Origin } from './defs.js';
import { asDomainKey, DOMAIN_STRING } from './domain-types.js';

// Given a feature step and the current world, populate the action args. This will update the existing stepValuesMap as actionVal
export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const stepArgs: TStepArgs = {};
	if (!featureStep.action.stepValuesMap) return stepArgs; // no variables for this step

	for (const [name, actionVal] of Object.entries(featureStep.action.stepValuesMap)) {
		const storedEntry = world.shared.all()[actionVal.term];
		if (actionVal.origin === Origin.statement) {
			actionVal.value = actionVal.term;
		} else if (actionVal.origin === Origin.env) {
			actionVal.value = world.options.envVariables[actionVal.term]; // might be undefined
			actionVal.domain = DOMAIN_STRING;
		} else if (actionVal.origin === Origin.var) {
			if (storedEntry) {
				actionVal.domain = storedEntry.domain;
				actionVal.value = storedEntry.value;
			}
		} else if (actionVal.origin === Origin.fallthrough) {
			if (world.options.envVariables[actionVal.term]) {
				actionVal.value = world.options.envVariables[actionVal.term];
			} else if (storedEntry) {
				actionVal.value = storedEntry.value;
				actionVal.domain = storedEntry.domain;
			} else {
				actionVal.value = actionVal.term;
				actionVal.domain = DOMAIN_STRING;
			}
		} else if (actionVal.origin === Origin.quoted) {
			actionVal.value = actionVal.term;
			actionVal.domain = DOMAIN_STRING;
		} else {
			throw new Error(`Unsupported origin type: ${actionVal.origin}`);
		}
		if (actionVal.value === undefined) {
			continue;
		}

		const actionDomainKey = asDomainKey(actionVal.domain.split('|').map(d => d.trim()));
		if (!world.domains[actionDomainKey]) {
			throw new Error(`No domain coercer found for domain "${actionDomainKey}"`);
		}

		actionVal.value = await Promise.resolve(world.domains[actionDomainKey].coerce(actionVal, steppers));

		// actionVal has been updated, update the actionVal in place for downstream processing
		stepArgs[name] = actionVal.value;
	}

	return stepArgs;
}
