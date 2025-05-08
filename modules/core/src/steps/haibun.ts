import { OK, TNamed, TWorld, TFeatureStep, STEP_DELAY, IStepperCycles, TResolvedFeature, SCENARIO_START } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { IHasOptions } from '../lib/astepper.js';
import { AStepper } from '../lib/astepper.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, actionOK, getStepperOption, sleep, stringOrError } from '../lib/util/index.js';
import { expand } from '../lib/features.js';
import { asFeatures } from '../lib/resolver-features.js';
import { copyPreRenderedAudio, preRenderFeatureProse, TRenderedAudioMap } from './lib/tts.js';
import { TArtifactSpeech } from '../lib/interfaces/logger.js';
import { captureLocator } from '../lib/capture-locator.js';
import { resolve } from 'path';
import { execSync } from 'child_process';

const cycles = (hb: Haibun): IStepperCycles => ({
	async startFeature(feature: TResolvedFeature) {
		if (!hb.ttsCmd) {
			return Promise.resolve();
		}
		hb.renderedAudio = await preRenderFeatureProse(feature, hb.ttsCmd, hb.world.logger);
	}
});
class Haibun extends AStepper implements IHasOptions {
	renderedAudio: TRenderedAudioMap = {};
	options = {
		TTS_CMD: {
			desc: `TTS command that accepts text as @WHAT@ and returns a full path to stdout`,
			parse: (input: string) => stringOrError(input),
			required: false
		},
		TTS_PLAY: {
			desc: `Shell command that plays an audio file using @WHAT@`,
			parse: (input: string) => stringOrError(input),
			required: false
		},
	}

	cycles = cycles(this);
	steppers: AStepper[];
	ttsCmd: string;
	ttsPlay: string;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.steppers = steppers;
		this.world = world;
		this.ttsCmd = getStepperOption(this, 'TTS_CMD', world.moduleOptions);
		this.ttsPlay = getStepperOption(this, 'TTS_PLAY', world.moduleOptions);
		return Promise.resolve();
	}
	steps = {
		prose: {
			gwta: '(?<what>.*[.?!])$',
			action: async (t: TNamed, featureStep: TFeatureStep) => {
				return await this.maybeSay(featureStep.in);
			}
		},
		feature: {
			match: /^Feature: ?(?<feature>.+)?$/,
			action: async ({ feature }: TNamed, featureStep: TFeatureStep) => {
				this.getWorld().shared.set('feature', feature);
				return await this.maybeSay(featureStep.in);
			},
		},
		[SCENARIO_START]: {
			match: /^Scenario: (?<scenario>.+)$/,
			action: async ({ scenario }: TNamed, featureStep: TFeatureStep) => {
				this.getWorld().shared.set('scenario', scenario);
				return await this.maybeSay(featureStep.in);
			},
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
				while (this.getWorld().shared.get(what) !== value) {
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
			gwta: ';;{comment}',
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
	async maybeSay(transcript: string) {
		if (!this.ttsCmd) {
			return OK;
		}
		const dir = captureLocator(this.world.options, this.world.tag);

		const { path, durationS } = await copyPreRenderedAudio(dir, this.renderedAudio, transcript);
		const runtimePath = resolve(dir);

		const artifact: TArtifactSpeech = { artifactType: 'speech', path, durationS, runtimePath, transcript };
		if (this.ttsPlay) {
			const playCmd = this.ttsPlay.replace(/@WHAT@/g, `${runtimePath}/${path}`);
			this.world.logger.debug(`playing audio: ${playCmd}`);
			try {
				execSync(playCmd, { stdio: 'pipe' }).toString();
			} catch (error: TAnyFixme) {
				const stderr = error.stderr ? error.stderr.toString() : '';
				this.world.logger.error(`Error playing audio using ${playCmd}: ${error.message}\nOutput: ${stderr}`);
				return actionNotOK(`Error playing audio: ${error.message}\nOutput: ${stderr}`);
			}
		} else {
			await sleep(durationS * 1000);
		}
		return actionOK({ artifact });
	}

	async newFeatureFromEffect(content: string, seq: number, steppers: AStepper[]): Promise<TFeatureStep> {
		const features = asFeatures([{ path: `resolved from ${content}`, content }]);
		const expandedFeatures = await expand([], features);
		const featureSteps = await new Resolver(steppers).findFeatureSteps(expandedFeatures[0]);
		return { ...featureSteps[0], seq };
	}
}

export default Haibun;
