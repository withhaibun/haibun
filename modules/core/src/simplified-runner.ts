import { TWorld, TOptions, TAnyFixme, TExecutorResult, TTag, TNotOKActionResult, TResolvedFeature } from './lib/defs.js';
import { WorldContext } from './lib/contexts.js';
import Logger from './lib/Logger.js';
import { Timer } from './lib/Timer.js';
import { getSteppers } from './lib/util/workspace-lib.js';
import { expand } from './lib/features.js';
import { verifyRequiredOptions, verifyExtraOptions, createSteppers, setStepperWorlds } from './lib/util/index.js';
import { getFeaturesAndBackgrounds } from './phases/collector.js';
import { getDomains, verifyDomainsOrError } from './lib/domain.js';
import Builder from './phases/Builder.js';
import { Executor } from './phases/Executor.js';
import { Resolver } from './phases/Resolver.js';

const defaultSteppers = [
	'~@haibun/domain-webpage/build/domain-webpage',
	'~@haibun/web-playwright/build/web-playwright',
	'~@haibun/domain-storage/build/domain-storage',
	'~@haibun/storage-fs/build/storage-fs',
	'vars',
	'credentials',
	'haibun',
];
const endFeatureCallback = undefined;

const featureDir = './test-features';

export class SimplifiedRunner {
	private world: TWorld;
	tag: TTag;

	constructor() {
		this.tag = { key: 'test', sequence: 0, featureNum: 0, loop: 0, member: 0, params: {}, trace: false };
		const shared = new WorldContext(this.tag);
		const logger = new Logger({ level: 'debug' });
		const timer = new Timer();
		const options: TOptions = { DEST: './output' };

		this.world = {
			tag: this.tag,
			shared,
			runtime: {},
			logger,
			options,
			extraOptions: { HAIBUN_O_WEBPLAYWRIGHT_STORAGE: 'StorageFS' },
			domains: [],
			timer,
			bases: [],
		};
	}

	async run() {
		let result: TExecutorResult = undefined;
		const { tag, world } = this;
		const errorBail = (phase: string, error: TAnyFixme, details?: TAnyFixme) => {
			this.world.logger.error(`errorBail ${phase} ${error} ${details}`, error.stack);
			result = {
				ok: false,
				shared: this.world.shared,
				tag,
				failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } },
			};
			throw Error(error);
		};
		let featuresBackgrounds;
		try {
			featuresBackgrounds = getFeaturesAndBackgrounds([featureDir], []);
		} catch (error) {
			console.error('Error collecting features and backgrounds:', error);
		}
		const { features, backgrounds } = featuresBackgrounds;
		try {
			const baseSteppers = await getSteppers(defaultSteppers).catch((error) => errorBail('Steppers', error));
			const csteppers = [...baseSteppers /*...addSteppers*/];

			await verifyRequiredOptions(csteppers, world.extraOptions).catch((error) => errorBail('RequiredOptions', error));
			await verifyExtraOptions(world.extraOptions, csteppers).catch((error) => errorBail('ExtraOptions', error));

			const expandedFeatures = await expand(backgrounds, features).catch((error) => errorBail('Expand', error));

			const steppers = await createSteppers(csteppers);

			await setStepperWorlds(steppers, world).catch((error) => errorBail('StepperOptions', error));

			world.domains = await getDomains(steppers).catch((error) => errorBail('GetDomains', error));
			await verifyDomainsOrError(steppers, world).catch((error) => errorBail('RequiredDomains', error));

			const resolver = new Resolver(steppers, this.world);
			const mappedValidatedSteps: TResolvedFeature[] = await resolver
				.resolveStepsFromFeatures(expandedFeatures)
				.catch((error) => errorBail('Resolve', error));

			world.logger.log(
				`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map(
					(e) => e.path
				)}), ${mappedValidatedSteps.length}`
			);

			result = await Executor.execute(csteppers, world, mappedValidatedSteps, endFeatureCallback).catch((error) =>
				errorBail('Execute', error)
			);
			if (!result || !result.ok) {
				let message;
				try {
					message =
						(result.featureResults[0].stepResults.find((s) => !s.ok)?.actionResults[0] as TNotOKActionResult)?.message ||
						result.featureResults;
				} catch (e) {
					message = e;
				}
				result.failure = {
					stage: 'Execute',
					error: { message, details: { stack: [], errors: result.featureResults?.filter((r) => !r.ok).map((r) => r.path) } },
				};
			}
		} catch (error) {
			if (!result) {
				errorBail('catch', error);
			}
		}
	}
}
