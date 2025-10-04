import { resolve } from 'path';

import { OK, TWorld, TFeatureStep, IStepperCycles, TStartFeature, TStepArgs, Origin } from '../lib/defs.js';
import { IHasCycles, IHasOptions } from '../lib/astepper.js';
import { AStepper } from '../lib/astepper.js';
import { actionNotOK, actionOK, getStepperOption, sleep, stringOrError } from '../lib/util/index.js';
import { actualURI } from '../lib/util/actualURI.js';
import { copyPreRenderedAudio, doExec, doSpawn, playAudioFile, preRenderFeatureProse, TRenderedAudioMap } from './lib/tts.js';
import { EExecutionMessageType, TArtifactSpeech, TArtifactVideo, TMessageContext } from '../lib/interfaces/logger.js';
import { captureLocator } from '../lib/capture-locator.js';

const CAPTURE_FILENAME = 'vcapture.webm';

const cycles = (narrator: Narrator): IStepperCycles => ({
	async startFeature({ resolvedFeature }: TStartFeature) {
		if (narrator.ttsCmd) {
			narrator.renderedAudio = await preRenderFeatureProse(resolvedFeature, narrator.ttsCmd, narrator.world.logger);
		}
		if (narrator.captureStart) {
			narrator.getWorld().logger.debug(`Spawning screen capture using ${narrator.captureStart}`);
			doSpawn(narrator.captureStart);
		}
	},
	async endFeature() {
		if (narrator.captureStop) {
			const uri = actualURI(CAPTURE_FILENAME);
			narrator.getWorld().logger.info(`Stopping vcapture ${uri} using ${narrator.captureStop}`);
			await sleep(2000);
			await doExec(narrator.captureStop, false);
			const path = captureLocator(narrator.world.options, narrator.world.tag);
			const artifact: TArtifactVideo = { artifactType: 'video', path };
			const context: TMessageContext = { incident: EExecutionMessageType.FEATURE_END, artifacts: [artifact], tag: narrator.getWorld().tag };
			narrator.getWorld().logger.log('feature video', context);
		}
	}
});

class Narrator extends AStepper implements IHasOptions, IHasCycles {
	renderedAudio: TRenderedAudioMap = {};
	options = {
		TTS_CMD: { desc: 'TTS command that accepts text as @WHAT@ and returns a full path to stdout', parse: (input: string) => stringOrError(input), required: false },
		TTS_PLAY: { desc: 'Shell command that plays an audio file using @WHAT@', parse: (input: string) => stringOrError(input), required: false },
		CAPTURE_START: { desc: 'Shell command to start screen capture', parse: (input: string) => stringOrError(input), required: false },
		CAPTURE_STOP: { desc: 'Shell command to stop screen capture', parse: (input: string) => stringOrError(input), required: false },
	};

	cycles = cycles(this);
	steppers: AStepper[] = [];
	ttsCmd: string | undefined;
	ttsPlay: string | undefined;
	captureStart: string | undefined;
	captureStop: string | undefined;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.ttsCmd = getStepperOption(this, 'TTS_CMD', world.moduleOptions);
		this.ttsPlay = getStepperOption(this, 'TTS_PLAY', world.moduleOptions);
		this.captureStart = getStepperOption(this, 'CAPTURE_START', world.moduleOptions);
		this.captureStop = getStepperOption(this, 'CAPTURE_STOP', world.moduleOptions);
	}

	private rememberAndSay(key: string, value: string) {
		this.getWorld().shared.set({ term: key, value, domain: 'string', origin: Origin.fallthrough });
		return this.maybeSay(value);
	}

	steps = {
		prose: {
			precludes: [`Haibun.prose`],
			match: /.+[.!?]$/,
			action: async (_args: TStepArgs, featureStep: TFeatureStep) => this.maybeSay(featureStep.in),
		},
		feature: {
			precludes: [`Haibun.feature`],
			gwta: 'Feature: {feature}',
			action: async ({ feature }: TStepArgs) => this.rememberAndSay('feature', feature as string),
		},
		scenario: {
			precludes: [`Haibun.scenario`],
			gwta: 'Scenario: {scenario}',
			action: async ({ scenario }: TStepArgs) => this.rememberAndSay('scenario', scenario as string),
		},
	};

	async maybeSay(transcript: string) {
		if (!this.ttsCmd) return OK;
		const dir = captureLocator(this.world.options, this.world.tag);
		const { path, durationS } = await copyPreRenderedAudio(dir, this.renderedAudio, transcript);
		const runtimePath = resolve(dir);
		const artifact: TArtifactSpeech = { artifactType: 'speech', path, durationS, transcript };
		if (this.ttsPlay) {
			const playCmd = this.ttsPlay.replace(/@WHAT@/g, `"${runtimePath}/${path}"`);
			try {
				this.world.logger.log(`playing audio: ${playCmd}`);
				await playAudioFile(playCmd);
			} catch (error: unknown) {
				const e = error as { message: string; stderr?: unknown };
				const stderr = e.stderr ? String(e.stderr) : '';
				this.world.logger.error(`Error playing audio using ${playCmd}: ${e.message}\nOutput: ${stderr}`);
				return actionNotOK(`Error playing audio: ${e.message}\nOutput: ${stderr}`);
			}
		} else {
			await sleep(durationS * 1000);
		}
		return actionOK({ artifact });
	}

}

export default Narrator;
