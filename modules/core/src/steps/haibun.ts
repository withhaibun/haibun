import { OK, TNamed, AStepper, TWorld, TFeatureStep, STEP_DELAY, TAnyFixme } from '../lib/defs.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, sleep } from '../lib/util/index.js';
import { expand } from '../lib/features.js';
import { asFeatures } from '../lib/resolver-features.js';

const Haibun = class Haibun extends AStepper {
	steppers: AStepper[];
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.steppers = steppers;
		this.world = world;
		return Promise.resolve();
	}
	steps = {
		prose: {
			gwta: '.*[.?!]$',
			action: async () => Promise.resolve(OK),
		},
		sequenceToken: {
			gwta: 'a sequence token {token}',
			action: async ({ token }: TNamed) => {
				this.getWorld().shared.set(token, '' + new Date().getTime());
				return Promise.resolve(OK);
			},
		},
		startStepDelay: {
			gwta: 'start step delay of (?<ms>.+)',
			action: async ({ ms }: TNamed) => {
				this.getWorld().options[STEP_DELAY] = parseInt(ms, 10);
				return Promise.resolve(OK);
			},
		},
		fails: {
			gwta: `fails with {message}`,
			action: async ({ message }: TNamed) => {
				return Promise.resolve(actionNotOK(`fails: ${message}`));
			},
		},
		stopStepDelay: {
			gwta: 'stop step delay',
			action: async () => {
				return Promise.resolve(OK);
			},
		},
		displayEnv: {
			gwta: 'show the environment',
			action: async () => {
				this.world?.logger.info(`env: ${JSON.stringify(this.world.options.envVariables)}`);
				return Promise.resolve(OK);
			},
		},
		showTag: {
			gwta: 'show stepper tag {which}',
			action: async ({ which }: TNamed) => {
				const what = which ? (this.getWorld().tag as TAnyFixme)[which] : this.getWorld().tag;
				this.world?.logger.info(`tag ${which}: ${JSON.stringify(what)}`);
				return Promise.resolve(OK);
			},
		},
		until: {
			gwta: 'until {what} is {value}',
			action: async ({ what, value }: TNamed) => {
				while (this.getWorld().shared.values[what] !== value) {
					await sleep(100);
				}
				return Promise.resolve(OK);
			},
		},
		pauseSeconds: {
			gwta: 'pause for {ms}s',
			action: async ({ ms }: TNamed) => {
				const seconds = parseInt(ms, 10) * 1000;
				await sleep(seconds);
				return Promise.resolve(OK);
			},
		},
		comment: {
			gwta: '#{comment}',
			action: async () => {
				return Promise.resolve(OK);
			},
		},
		afterEveryStepper: {
			gwta: 'after every {stepperName}, {line}',
			action: async () => {
				return Promise.resolve(OK);
			},
			applyEffect: async ({ stepperName, line }: TNamed, currentFeatureStep: TFeatureStep, steppers: AStepper[]) => {
				const newSteps = [];

				newSteps.push(currentFeatureStep);
				if (currentFeatureStep.action.stepperName === stepperName) {
					const newFeatureStep = await this.newFeatureFromEffect(line, currentFeatureStep.seq + 0.1, steppers);
					newSteps.push(newFeatureStep);
				}
				return newSteps;
			}
		},
	};
	async newFeatureFromEffect(content: string, seq: number, steppers: AStepper[]): Promise<TFeatureStep> {
		const features = asFeatures([{ path: `resolved from ${content}`, content }]);
		const expandedFeatures = await expand([], features);
		const featureSteps = await new Resolver(steppers).findFeatureSteps(expandedFeatures[0]);
		return { ...featureSteps[0], seq };
	}
};

export default Haibun;
