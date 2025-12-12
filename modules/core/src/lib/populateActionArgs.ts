import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld } from './defs.js';

export function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): TStepArgs {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs;

	for (const [name, actionVal] of Object.entries(featureStep.action.stepValuesMap)) {
		const resolved = world.shared.resolveVariable(actionVal, featureStep, steppers);
		// FIXME all steps except set steps should fail if a variable is undefined and it's authoritative
		if (resolved.value === undefined) {
			const handlesUndefined = (featureStep.action.step.handlesUndefined);
			if (handlesUndefined === true || handlesUndefined?.includes(name)) {
				continue;
			}
			console.error(`undefined ${name} in "${featureStep.in}" for ${featureStep.action.stepperName}.${featureStep.action.actionName}`, name, resolved, featureStep.action.step);
			throw Error(`undefined ${name} in "${featureStep.in}" for ${featureStep.action.stepperName}.${featureStep.action.actionName}`);
		}
		stepArgs[name] = resolved.value;
	}
	return stepArgs;
}
