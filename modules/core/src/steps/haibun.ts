import { OK, TNamed, AStepper, TWorld, TFeatureStep, STEP_DELAY, TAnyFixme, IHasOptions } from '../lib/defs.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, findStepperFromOption, getStepperOption, sleep, stringOrError } from '../lib/util/index.js';
import { expand } from '../lib/features.js';
import { asFeatures } from '../lib/resolver-features.js';
import { sayText } from './lib/say-text.js';
import { cpSync } from 'fs';
import { TArtifactSpeech } from '../lib/interfaces/artifacts.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';
import { resolve } from 'path';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';

const Haibun = class Haibun extends AStepper implements IHasOptions {

	options = {
		TTS_CMD: {
			desc: `TTS "say" command that accepts text as @WHAT@ and returns a full path to stdout`,
			parse: (input: string) => stringOrError(input),
			required: false
		},
		STORAGE: {
			desc: 'Storage for output',
			parse: (input: string) => stringOrError(input),
			required: false
		},
	}

	steppers: AStepper[];
	ttsCmd: string;
	storage: AStorage;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.steppers = steppers;
		this.world = world;
		this.ttsCmd = getStepperOption(this, 'TTS_CMD', world.moduleOptions);
		this.storage = getStepperOption(this, 'STORAGE', world.moduleOptions) ? findStepperFromOption(steppers, this, world.moduleOptions, 'STORAGE') : undefined;
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
		sayText: {
			gwta: 'say {transcript}',
			action: async ({ transcript }: TNamed) => {
				if (!this.ttsCmd || !this.storage) {
					return Promise.resolve(actionNotOK('say requires TTS_CMD (which accepts input as @WHAT@ and returns a full path) and STORAGE'));
				}
				this.getWorld().logger.debug(`saying ${transcript}`);
				const fn = sayText(this.ttsCmd, transcript);
				const loc = await this.storage.ensureCaptureLocation({ ...this.getWorld(), mediaType: EMediaTypes.video });
				const destFN = `speech-${this.getWorld().tag.sequence}-${Date.now()}.wav`;
				const path = resolve(this.storage.fromLocation(EMediaTypes.video, loc, destFN));
				const runtimePath = await this.storage.runtimePath();
				cpSync(fn, path);
				this.getWorld().logger.debug(`copied audio to ${path}`);
				const artifact: TArtifactSpeech = { artifactType: 'speech', path: destFN, runtimePath, transcript };
				const context: TMessageContext = {
					incident: EExecutionMessageType.ACTION,
					artifact,
					tag: this.getWorld().tag,
				};

				this.getWorld().logger.info('said audio', context);
				return OK;
			}

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
