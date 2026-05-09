import { AStepper, TFeatureStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { TStepArgs } from "../schema/protocol.js";

export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs;

	for (const [name, actionVal] of Object.entries(featureStep.action.stepValuesMap)) {
		if (actionVal.value !== undefined) {
			stepArgs[name] = actionVal.value;
			continue;
		}
		const resolved = await world.shared.resolveVariable(actionVal, featureStep, steppers, { secure: true });
		if (resolved.value === undefined) {
			const handlesUndefined = featureStep.action.step.handlesUndefined;
			if (handlesUndefined === true || handlesUndefined?.includes(name)) continue;
			console.error(`undefined ${name} in "${featureStep.in}" for ${featureStep.action.stepperName}.${featureStep.action.actionName}`, name, resolved, featureStep.action.step);
			throw Error(`undefined ${name} in "${featureStep.in}" for ${featureStep.action.stepperName}.${featureStep.action.actionName}`);
		}
		stepArgs[name] = resolved.value;
	}
	return stepArgs;
}
