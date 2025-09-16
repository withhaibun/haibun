import { TFeatureStep, TStepArgs } from './defs.js';

export function simplifyStepArgs(featureStep: TFeatureStep): TStepArgs {
	const values: TStepArgs = {};
	// This just assigns value to the simplified args. value is assigned earlier (in variables-stepper set).
	// This function is not responsible for validating or filling that value if it's not present.
	// If something is wrong, like any other deep function based on formulated input, it will fail.
	for (const [label, sv] of Object.entries(featureStep.action.stepValuesMap)) {
		values[label] = sv.value;
	}
	return values;
}
