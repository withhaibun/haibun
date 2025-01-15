import { TWorld, TExecutorResult, TAnyFixme, TResolvedFeature, CStepper } from './lib/defs.js';
import { expand } from './lib/features.js';
import { verifyRequiredOptions, verifyExtraOptions, createSteppers, setStepperWorlds } from './lib/util/index.js';
import { getSteppers } from './lib/util/workspace-lib.js';
import { getFeaturesAndBackgrounds, TFeaturesBackgrounds } from './phases/collector.js';
import { Executor } from './phases/Executor.js';
import { Resolver } from './phases/Resolver.js';

export class Runner {
	private result: TExecutorResult = undefined;
	private world: TWorld;

	constructor(world: TWorld) {
		this.world = world;
	}

	private errorBail = (phase: string, error: TAnyFixme, details?: TAnyFixme) => {
		this.world.logger.error(`errorBail ${phase} ${error} ${details}`, error.stack);
		this.result = {
			ok: false,
			shared: this.world.shared,
			tag: this.world.tag,
			failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } },
		};
		throw Error(error);
	};

	async run(steppers: string[]) {
		let featuresBackgrounds: TFeaturesBackgrounds = undefined;
		try {
			featuresBackgrounds = getFeaturesAndBackgrounds(this.world.bases, []);
		} catch (error) {
			console.error('Error collecting features and backgrounds:', error);
			throw error;
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

			const expandedFeatures = await expand(backgrounds, features).catch((error) => this.errorBail('Expand', error));

			const steppers = await createSteppers(csteppers);

			await setStepperWorlds(steppers, this.world).catch((error) => this.errorBail('StepperOptions', error));

			const resolver = new Resolver(steppers, this.world);
			const mappedValidatedSteps: TResolvedFeature[] = await resolver
				.resolveStepsFromFeatures(expandedFeatures)
				.catch((error) => this.errorBail('Resolve', error));

			this.world.logger.log(
				`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map(
					(e) => e.path
				)}), ${mappedValidatedSteps.length}`
			);

			this.result = await Executor.execute(csteppers, this.world, mappedValidatedSteps).catch((error) =>
				this.errorBail('Execute', error)
			);
		} catch (error) {
			if (!this.result) {
				this.errorBail('catch', error);
			}
		}

		return this.result;
	}
}
