import { TWorld, TResolvedFeature, TFeatureStep, TStepperStep } from './lib/defs.js';
import { TAnyFixme } from './lib/fixme.js';
import { AStepper } from './lib/astepper.js';
import { populateActionArgs } from './lib/populateActionArgs.js';
import { constructorName } from './lib/util/index.js';

export async function applyEffectFeatures(world: TWorld, resolvedFeatures: TResolvedFeature[], steppers: AStepper[]): Promise<TResolvedFeature[]> {
	const appliedFeatures = [];

	for (const feature of resolvedFeatures) {
		const featureSteps: TFeatureStep[] = [];
		const newFeature = { ...feature, featureSteps: [] };
		const appliers: { applier: TStepperStep; namedWithVars: TAnyFixme; }[] = [];
		for (const featureStep of feature.featureSteps) {
			let newSteps = [featureStep];
			const action = featureStep.action;
			const stepper = steppers.find((s) => constructorName(s) === action.stepperName);

			if (stepper?.steps[action.actionName].applyEffect) {
				const applier = stepper?.steps[action.actionName];
				// simplifyStepArgs is async (may await domain coercers) so await it here
				const namedWithVars = await populateActionArgs(featureStep, world, steppers);
				appliers.push({ applier, namedWithVars });
			} else if (appliers.length > 0) {
				newSteps = [];
				for (const a of appliers) {
					const applied = await a.applier.applyEffect(a.namedWithVars, featureStep, steppers);
					if (applied.length < 1) throw Error('wtw');
					newSteps.push(...applied);
				}
			}
			featureSteps.push(...newSteps);
		}
		appliedFeatures.push({ ...newFeature, featureSteps });
	}
	return appliedFeatures;
}
