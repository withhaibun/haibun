import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld } from './defs.js';

export function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): TStepArgs {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs;

	for (const [name, actionVal] of Object.entries(featureStep.action.stepValuesMap)) {
		const resolved = world.shared.resolveVariable(actionVal, featureStep, steppers);
		stepArgs[name] = resolved.value;
	}
	return stepArgs;
}
