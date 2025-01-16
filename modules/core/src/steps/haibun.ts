import { OK, TNamed, AStepper, TWorld, TVStep, TStep, TResolvedFeature, TFeature, TExpandedFeature } from '../lib/defs.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, findStepper, sleep } from '../lib/util/index.js';
import { expand, findFeatures } from '../lib/features.js';
import { asExpandedFeatures, asFeatures } from '../lib/resolver-features.js';
import { resolve } from 'path';

const Haibun = class Haibun extends AStepper {
	steppers: AStepper[];
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.steppers = steppers;
		this.world = world;
	}
	steps = {
		prose: {
			gwta: '.*[.?!]$',
			action: async () => OK,
		},
		sequenceToken: {
			gwta: 'a sequence token {token}',
			action: async ({ token }: TNamed) => {
				this.getWorld().shared.set(token, '' + new Date().getTime());
				return OK;
			},
		},
		startStepDelay: {
			gwta: 'start step delay of (?<ms>.+)',
			action: async ({ ms }: TNamed) => {
				this.getWorld().options.step_delay = parseInt(ms, 10);
				return OK;
			},
		},
		fails: {
			gwta: `fails with {message}`,
			action: async ({ message }: TNamed) => {
				return actionNotOK(`fails: ${message}`);
			},
		},
		stopStepDelay: {
			gwta: 'stop step delay',
			action: async () => {
				return OK;
			},
		},
		displayEnv: {
			gwta: 'show the environment',
			action: async () => {
				this.world?.logger.log(`env: ${JSON.stringify(this.world.options.env)}`);
				return OK;
			},
		},
		showTag: {
			gwta: 'show stepper tag {which}',
			action: async ({ which }: TNamed) => {
				const what = which ? (this.getWorld().tag as any)[which] : this.getWorld().tag;
				this.world?.logger.log(`tag ${which}: ${JSON.stringify(what)}`);
				return OK;
			},
		},
		until: {
			gwta: 'until {what} is {value}',
			action: async ({ what, value }: TNamed) => {
				while (this.getWorld().shared.values[what] !== value) {
					await sleep(100);
				}
				return OK;
			},
		},
		pauseSeconds: {
			gwta: 'pause for {ms}s',
			action: async ({ ms }: TNamed) => {
				const seconds = parseInt(ms, 10) * 1000;
				await sleep(seconds);
				return OK;
			},
		},
		comment: {
			gwta: '#{comment}',
			action: async () => {
				return OK;
			},
		},
		afterEveryStepper: {
			gwta: 'after every {stepperName}, {line}',
			action: async (usedInResolved: TNamed) => {
				return OK;
			},
			effectCallback: async ({ stepperName, line }: TNamed, resolvedFeatures: TResolvedFeature[]) => {
				console.log('afterEvery resolvedCallback called with:', stepperName, line, resolvedFeatures);
				const modifiedFeatures: TResolvedFeature[] = [];

				for (const rf of resolvedFeatures) {
					modifiedFeatures.push(rf);
					for (const vstep of rf.vsteps) {
						for (const vAction of vstep.actions) {
							if (vAction.stepperName === stepperName) {
								const theStepper = findStepper<AStepper>(this.steppers, stepperName);
								let newSeq = rf.vsteps[0].seq + 0.1;
								while (modifiedFeatures.find((f) => f.vsteps[0].seq === newSeq)) {
									newSeq += 0.1;
								}
								const newFeature = await this.newFeatureFromEffect(theStepper, line, newSeq);
								console.log('found stepper', line, stepperName, 'in', vAction.stepperName, '::', newFeature);
								modifiedFeatures.push(newFeature);
							}
						}
					}
				}

				console.log('🤑', JSON.stringify(modifiedFeatures, null, 2));
				return modifiedFeatures;
			},
		},
	};
	async newFeatureFromEffect(stepper: AStepper, line: string, newSeq: number): Promise<TResolvedFeature> {
		const features = asFeatures([{ path: `resolved from ${line}`, content: line }]);
		const expandedFeatures = await expand([], features);

		const resolver = new Resolver([stepper], this.world);
		const resolvedFeature = (await resolver.resolveStepsFromFeatures(expandedFeatures))[0];
		resolvedFeature.vsteps[0].seq = newSeq;
		return resolvedFeature;
	}
};

export default Haibun;
