import { TWorld, TExecutorResult, TAnyFixme, CStepper, AStepper, TResolvedFeature, TStepAction } from './lib/defs.js';
import { expand } from './lib/features.js';
import { getNamedToVars } from './lib/namedVars.js';
import { verifyRequiredOptions, verifyExtraOptions, createSteppers, setStepperWorlds, constructorName, doStepperCycleMethods } from './lib/util/index.js';
import { getSteppers } from './lib/util/workspace-lib.js';
import { getFeaturesAndBackgrounds, TFeaturesBackgrounds } from './phases/collector.js';
import { Executor } from './phases/Executor.js';
import { Resolver } from './phases/Resolver.js';

export class Runner {
	private result: TExecutorResult = undefined;
	steppers: AStepper[];

	constructor(private world: TWorld) { }

	private errorBail = (phase: string, error: TAnyFixme, details?: TAnyFixme) => {
		this.world.logger.error(`errorBail ${phase} ${error} ${details}`, error.stack);
		this.result = {
			ok: false,
			shared: this.world.shared,
			tag: this.world.tag,
			failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } },
			steppers: this.steppers
		};
		throw Error(error);
	};

	async run(steppers: string[], featureFilter = []): Promise<TExecutorResult> {
		let featuresBackgrounds: TFeaturesBackgrounds = undefined;
		try {
			featuresBackgrounds = getFeaturesAndBackgrounds(this.world.bases, featureFilter);
		} catch (error) {
			this.errorBail('Collector', error);
		}

		const { features, backgrounds } = featuresBackgrounds;
		const cSteppers = await getSteppers(steppers).catch((error) => this.errorBail('Steppers', error));
		const featureResults = await this.runFeaturesAndBackgrounds(cSteppers, { features, backgrounds });
		return featureResults;
	}

	async runFeaturesAndBackgrounds(csteppers: CStepper[], { features, backgrounds }: TFeaturesBackgrounds) {
		try {
			await verifyRequiredOptions(csteppers, this.world.moduleOptions).catch((error) =>
				this.errorBail('RequiredOptions', error)
			);
			await verifyExtraOptions(this.world.moduleOptions, csteppers).catch((error) => this.errorBail('moduleOptions', error));
			this.steppers = await createSteppers(csteppers);
			await setStepperWorlds(this.steppers, this.world).catch((error) => this.errorBail('StepperOptions', error));

			const expandedFeatures = await expand(backgrounds, features).catch((error) => this.errorBail('Expand', error));

			const resolver = new Resolver(this.steppers);
			const resolvedFeatures = await resolver
				.resolveStepsFromFeatures(expandedFeatures)
				.catch((error) => this.errorBail('Resolve', error));

			const appliedResolvedFeatures = await this.applyEffectFeatures(resolvedFeatures, this.steppers);

			this.world.logger.log(
				`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map(
					(e) => e.path
				)}), ${appliedResolvedFeatures.length}`
			);

			await doStepperCycleMethods(this.steppers, 'startExecution');
			this.result = await Executor.executeFeatures(this.steppers, this.world, appliedResolvedFeatures).catch((error) =>
				this.errorBail('Execute', error)
			);
		} catch (error) {
			if (!this.result) {
				this.errorBail('catch', error);
			}
		}

		return this.result;
	}

	private async applyEffectFeatures(resolvedFeatures: TResolvedFeature[], steppers: AStepper[]) {
		let allFeatures = [...resolvedFeatures];

		for (const feature of resolvedFeatures) {
			for (const featureStep of feature.featureSteps) {
				const action = featureStep.action;
				const stepper = steppers.find((s) => constructorName(s) === action.stepperName);
				if (stepper && stepper.steps[action.actionName]?.applyEffect) {
					const found: TStepAction = action;
					const namedWithVars = getNamedToVars(found, this.world, featureStep);
					allFeatures = await stepper.steps[action.actionName].applyEffect(namedWithVars, [feature]);
				}
			}
		}
		return allFeatures;
	}
}
