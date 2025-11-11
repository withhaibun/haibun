import { TWorld, TExecutorResult, CStepper } from './lib/defs.js';
import { TAnyFixme } from './lib/fixme.js';
import { AStepper } from './lib/astepper.js';
import { expand } from './lib/features.js';
import { verifyRequiredOptions, verifyExtraOptions, createSteppers, setStepperWorldsAndDomains } from './lib/util/index.js';
import { getSteppers } from './lib/util/workspace-lib.js';
import { getFeaturesAndBackgrounds, TFeaturesBackgrounds } from './phases/collector.js';
import { Executor } from './phases/Executor.js';
import { Resolver } from './phases/Resolver.js';

export class Runner {
	private result: TExecutorResult = undefined;
	steppers: AStepper[];

	constructor(private world: TWorld) { }

	private errorBail = (phase: string, error: TAnyFixme, details?: TAnyFixme) => {
		if (typeof error?.stack === 'string') { // FIXME
			error.stack = error.stack.split('\n');
		}
		// this.world.logger.error(`errorBail ${phase} ${error} ${details}`, error.stack);
		this.result = {
			ok: false,
			shared: this.world.shared,
			tag: this.world.tag,
			failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } },
			steppers: this.steppers
		};
		// console.error(error.stack);
		throw Error(error);
	};

	async run(steppers: string[], featureFilter = []): Promise<TExecutorResult> {
		let featuresBackgrounds: TFeaturesBackgrounds = undefined;
		try {
			featuresBackgrounds = await getFeaturesAndBackgrounds(this.world.bases, featureFilter);
		} catch (error) {
			this.errorBail('Collector', error);
		}

		const csteppers = await getSteppers(steppers).catch((error) => this.errorBail('Steppers', error));
		await verifyRequiredOptions(csteppers, this.world.moduleOptions).catch((error) => this.errorBail('RequiredOptions', error));
		await verifyExtraOptions(this.world.moduleOptions, csteppers).catch((error) => this.errorBail('moduleOptions', error));

		const featureResults = await this.runFeaturesAndBackgrounds(csteppers, featuresBackgrounds);
		return featureResults;
	}

	async runFeaturesAndBackgrounds(csteppers: CStepper[], featuresBackgrounds: TFeaturesBackgrounds) {
		try {
			this.steppers = await createSteppers(csteppers);
			await setStepperWorldsAndDomains(this.steppers, this.world);
			// Make backgrounds available at runtime for inline `Backgrounds:` expansion
			this.world.runtime.backgrounds = featuresBackgrounds.backgrounds;
			const expandedFeatures = await expand(featuresBackgrounds).catch((error) => this.errorBail('Expand', error));

			const resolver = new Resolver(this.steppers, featuresBackgrounds.backgrounds);
			const resolvedFeatures = await resolver.resolveStepsFromFeatures(expandedFeatures).catch((error) => this.errorBail('Resolve', error));

			this.result = await Executor.executeFeatures(this.steppers, this.world, resolvedFeatures).catch((error) =>
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
