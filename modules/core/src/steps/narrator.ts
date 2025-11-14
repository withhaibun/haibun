import { resolve } from 'path';

import { TWorld, TFeatureStep, IStepperCycles, TStartFeature, TStepArgs, Origin } from '../lib/defs.js';
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
			narrator.renderedAudio = await preRenderFeatureProse(resolvedFeature, narrator.world.logger);
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
		CAPTURE_START: { desc: 'Shell command to start screen capture', parse: (input: string) => stringOrError(input), required: false },
		CAPTURE_STOP: { desc: 'Shell command to stop screen capture', parse: (input: string) => stringOrError(input), required: false },
	};

	cycles = cycles(this);
	steppers: AStepper[] = [];
	captureStart: string | undefined;
	captureStop: string | undefined;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.captureStart = getStepperOption(this, 'CAPTURE_START', world.moduleOptions);
		this.captureStop = getStepperOption(this, 'CAPTURE_STOP', world.moduleOptions);
	}

	private rememberAndSay(key: string, value: string, featureStep: TFeatureStep) {
		this.getWorld().shared.set({ term: key, value, domain: 'string', origin: Origin.fallthrough }, { in: featureStep.in, seq: featureStep.seqPath, when: `${featureStep.action.stepperName}.${featureStep.action.actionName}` });
		// Use featureStep.in for audio playback since that's what was pre-rendered
		return this.maybeSay(featureStep.in);
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
			action: async ({ feature }: TStepArgs, featureStep: TFeatureStep) => this.rememberAndSay('feature', feature as string, featureStep),
		},
		scenario: {
			precludes: [`Haibun.scenario`],
			gwta: 'Scenario: {scenario}',
			action: async ({ scenario }: TStepArgs, featureStep: TFeatureStep) => this.rememberAndSay('scenario', scenario as string, featureStep),
		},
	};

	async maybeSay(transcript: string) {
		const dir = captureLocator(this.world.options, this.world.tag);
		const { path, durationS } = copyPreRenderedAudio(dir, this.renderedAudio, transcript);
		const runtimePath = resolve(dir);
		const artifact: TArtifactSpeech = { artifactType: 'speech', path, durationS, transcript };

		// Play audio using built-in ffmpeg playback
		try {
			const audioFullPath = `${runtimePath}/${path}`;
			this.world.logger.debug(`playing audio: ${audioFullPath}`);
			await playAudioFile(audioFullPath);
		} catch (error: unknown) {
			const e = error as { message: string; stderr?: unknown };
			const stderr = e.stderr ? String(e.stderr) : '';
			this.world.logger.error(`Error playing audio: ${e.message}\nOutput: ${stderr}`);
			return actionNotOK(`Error playing audio: ${e.message}\nOutput: ${stderr}`);
		}
		return actionOK({ artifact });
	}

}

export default Narrator;
