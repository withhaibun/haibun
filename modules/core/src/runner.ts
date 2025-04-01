import { applyEffectFeatures } from './applyEffectFeatures.js';
import { TWorld, TExecutorResult, TAnyFixme, CStepper, AStepper } from './lib/defs.js';
import { expand } from './lib/features.js';
import { verifyRequiredOptions, verifyExtraOptions, createSteppers, setStepperWorlds } from './lib/util/index.js';
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
		console.error(error.stack);
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
			await verifyRequiredOptions(csteppers, this.world.moduleOptions).catch((error) => this.errorBail('RequiredOptions', error));
			await verifyExtraOptions(this.world.moduleOptions, csteppers).catch((error) => this.errorBail('moduleOptions', error));
			this.steppers = await createSteppers(csteppers);
			await setStepperWorlds(this.steppers, this.world);

			const expandedFeatures = await expand(backgrounds, features).catch((error) => this.errorBail('Expand', error));

			const resolver = new Resolver(this.steppers);
			const resolvedFeatures = await resolver.resolveStepsFromFeatures(expandedFeatures).catch((error) => this.errorBail('Resolve', error));
			const appliedResolvedFeatures = await applyEffectFeatures(this.world, resolvedFeatures, this.steppers);

			this.world.logger.log(`features: ${appliedResolvedFeatures.length} (${appliedResolvedFeatures.map((e) => e.path)}) backgrounds: ${backgrounds.length}`);

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
}
