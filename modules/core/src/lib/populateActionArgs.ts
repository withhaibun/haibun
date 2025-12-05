import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld, Origin } from './defs.js';
import { DOMAIN_STRING, normalizeDomainKey } from './domain-types.js';

// Given a feature step and the current world, populate the action args. This will update the existing stepValuesMap as actionVal
export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs; // no variables for this step

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
				actionVal.provenance = storedEntry.provenance;
			}
		} else if (actionVal.origin === Origin.fallthrough) {
			if (world.options.envVariables[actionVal.term]) {
				actionVal.value = world.options.envVariables[actionVal.term];
			} else if (storedEntry) {
				actionVal.value = storedEntry.value;
				actionVal.domain = storedEntry.domain;
				actionVal.provenance = storedEntry.provenance;
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
