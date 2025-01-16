import {
	OK,
	TNamed,
	AStepper,
	TWorld,
	TFeatureStep,
	TStepperStep,
	TResolvedFeature,
	TFeature,
	TExpandedFeature,
} from '../lib/defs.js';
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
			action: async (usedInEffect: TNamed) => {
				return OK;
			},
			applyEffect: async ({ stepperName, line }: TNamed, resolvedFeatures: TResolvedFeature[]) => {
				const modifiedFeatures: TResolvedFeature[] = [];

				for (const rf of resolvedFeatures) {
					const theStepper = findStepper<AStepper>(this.steppers, stepperName);
					const newSteps = [];

					for (const vstep of rf.vsteps) {
						newSteps.push(vstep);
						if (vstep.action.stepperName === stepperName) {
							const newFeatureStep = await this.newFeatureFromEffect(theStepper, line, vstep.seq + 0.1);
							newSteps.push(newFeatureStep);
						}
					}
					rf.vsteps = newSteps;
					modifiedFeatures.push(rf);
				}

				return modifiedFeatures;
			},
		},
	};
	async newFeatureFromEffect(stepper: AStepper, content: string, seq: number): Promise<TFeatureStep> {
		const features = asFeatures([{ path: `resolved from ${content}`, content }]);
		const expandedFeatures = await expand([], features);
		const vsteps = await new Resolver([stepper]).findFeatureSteps(expandedFeatures[0]);
		return { ...vsteps[0], seq };
	}
};

export default Haibun;
