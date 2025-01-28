import {
	AStepper,
	CStepper,
	TAnyFixme,
	TEndFeatureCallback,
	TExecutorResult,
	TNamed,
	TResolvedFeature,
	TStepAction,
	TStepperStep,
	TWorld,
} from './lib/defs.js';
import { expand } from './lib/features.js';
import { getNamedToVars } from './lib/namedVars.js';
import {
	constructorName,
	createSteppers,
	setStepperWorlds,
	verifyExtraOptions,
	verifyRequiredOptions,
} from './lib/util/index.js';
import { getSteppers } from './lib/util/workspace-lib.js';
import { getFeaturesAndBackgrounds, TFeaturesBackgrounds } from './phases/collector.js';
import { Executor } from './phases/Executor.js';
import { Resolver } from './phases/Resolver.js';

export type TRunnerCallbacks = {
	endFeature?: TEndFeatureCallback[];
};

export class Runner {
	private result: TExecutorResult = undefined;

	constructor(private world: TWorld, private callbacks: TRunnerCallbacks = {}) {}

	private errorBail = (phase: string, error: TAnyFixme, details?: TAnyFixme) => {
		console.error(error);
		this.world.logger.error(`errorBail ${phase} ${error} ${details}`, error.stack);
		this.result = {
			ok: false,
			shared: this.world.shared,
			tag: this.world.tag,
			failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } },
		};
		throw Error(error);
	};

	async run(steppers: string[], featureFilter: string[]) {
		let featuresBackgrounds: TFeaturesBackgrounds = undefined;
		try {
			featuresBackgrounds = getFeaturesAndBackgrounds(this.world.bases, featureFilter);
		} catch (error) {
			this.errorBail('Collector', error);
		}

		const { features, backgrounds } = featuresBackgrounds;
		const cSteppers = await getSteppers(steppers).catch((error) => this.errorBail('Steppers', error));
		return await this.runFeaturesAndBackgrounds(cSteppers, { features, backgrounds });
	}

	async runFeaturesAndBackgrounds(csteppers: CStepper[], { features, backgrounds }: TFeaturesBackgrounds) {
		try {
			await verifyRequiredOptions(csteppers, this.world.moduleOptions).catch((error) =>
				this.errorBail('RequiredOptions', error)
			);
			await verifyExtraOptions(this.world.moduleOptions, csteppers).catch((error) => this.errorBail('moduleOptions', error));
			const steppers = await createSteppers(csteppers);
			await setStepperWorlds(steppers, this.world).catch((error) => this.errorBail('StepperOptions', error));

			const expandedFeatures = await expand(backgrounds, features).catch((error) => this.errorBail('Expand', error));

			const resolver = new Resolver(steppers);
			const resolvedFeatures = await resolver
				.resolveStepsFromFeatures(expandedFeatures)
				.catch((error) => this.errorBail('Resolve', error));

			const appliedResolvedFeatures = await this.applyEffectFeatures(resolvedFeatures, steppers);

			this.world.logger.log(
				`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map(
					(e) => e.path
				)}), ${appliedResolvedFeatures.length}`
			);

			this.result = await Executor.execute(csteppers, this.world, appliedResolvedFeatures, this.callbacks.endFeature).catch(
				(error) => this.errorBail('Execute', error)
			);
		} catch (error) {
			if (!this.result) {
				this.errorBail('catch', error);
			}
		}

		return this.result;
	}

	private async applyEffectFeatures(resolvedFeatures: TResolvedFeature[], steppers: AStepper[]) {
		let newFeatures = [];

		for (const feature of resolvedFeatures) {
			let foundEffect: { stepperStep: TStepperStep; namedWithVars: TNamed } = undefined;
			const newFeature = { ...feature, featureSteps: [] };
			for (const featureStep of feature.featureSteps) {
				if (foundEffect) {
					const newSteps = await foundEffect.stepperStep.applyEffect(foundEffect.namedWithVars, featureStep);
					newFeature.featureSteps.push(...newSteps);
				} else {
					newFeature.featureSteps.push(featureStep);
				}
				const stepperStep = steppers.find((s) => constructorName(s) === featureStep.action.stepperName).steps[
					featureStep.action.actionName
				];
				if (stepperStep.applyEffect) {
					const namedWithVars = getNamedToVars(featureStep.action, this.world, featureStep);
					foundEffect = { stepperStep, namedWithVars };
				}
			}
			newFeatures.push(newFeature);
		}
		return newFeatures;
	}
}
