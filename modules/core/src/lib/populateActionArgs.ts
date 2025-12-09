import { AStepper } from './astepper.js';
import { Origin, TFeatureStep, TStepArgs, TWorld } from './defs.js';

// Given a feature step and the current world, populate the action args.
// Uses resolveVariable which handles resolution and coercion.
export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs;

	for (const [name, actionVal] of Object.entries(featureStep.action.stepValuesMap)) {
		const resolved = world.shared.resolveVariable(
			{ term: actionVal.term, origin: actionVal.origin, domain: actionVal.domain },
			featureStep,
			steppers
		);

		if (resolved.value !== undefined) {
			stepArgs[name] = resolved.value;
		}
	}
	return stepArgs;
}

