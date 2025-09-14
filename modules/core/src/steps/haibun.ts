import { resolve } from 'path';

import { OK, TStepArgs, TWorld, TFeatureStep, STEP_DELAY, IStepperCycles, SCENARIO_START, TStartFeature, TStepResult } from '../lib/defs.js';
import { IHasCycles, IHasOptions } from '../lib/astepper.js';
import { AStepper } from '../lib/astepper.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, actionOK, formattedSteppers, getStepperOption, sleep, stringOrError } from '../lib/util/index.js';
import { actualURI } from '../lib/util/actualURI.js';
import { expand } from '../lib/features.js';
import { asFeatures } from '../lib/resolver-features.js';
import { copyPreRenderedAudio, doExec, doSpawn, playAudioFile, preRenderFeatureProse, TRenderedAudioMap } from './lib/tts.js';
import { EExecutionMessageType, TArtifactSpeech, TArtifactVideo, TMessageContext } from '../lib/interfaces/logger.js';
import { captureLocator } from '../lib/capture-locator.js';
import { endExecutonContext, FeatureExecutor } from '../phases/Executor.js';
import { doExecuteFeatureSteps } from '../lib/util/resolveAndExecuteStatement.js';

const CAPTURE_FILENAME = 'vcapture.webm';

const cycles = (hb: Haibun): IStepperCycles => ({
	async startFeature({ resolvedFeature }: TStartFeature) {
		if (hb.ttsCmd) {
			hb.renderedAudio = await preRenderFeatureProse(resolvedFeature, hb.ttsCmd, hb.world.logger);
		}
		if (hb.captureStart) {
			hb.getWorld().logger.debug(`Spawning screen capture using ${hb.captureStart}`);
			doSpawn(hb.captureStart);
		}
	},
	async endFeature() {
		if (hb.captureStop) {
			const uri = actualURI(CAPTURE_FILENAME);
			hb.getWorld().logger.info(`Stopping vcapture ${uri} using ${hb.captureStop}`);
			await sleep(2000);
			await doExec(hb.captureStop, false);
			const path = captureLocator(hb.world.options, hb.world.tag);
			const artifact: TArtifactVideo = { artifactType: 'video', path };
			const context: TMessageContext = { incident: EExecutionMessageType.FEATURE_END, artifacts: [artifact], tag: hb.getWorld().tag };
			hb.getWorld().logger.log('feature video', context);
		}
	}
});

class Haibun extends AStepper implements IHasOptions, IHasCycles {
	renderedAudio: TRenderedAudioMap = {};
	options = {
		TTS_CMD: { desc: 'TTS command that accepts text as @WHAT@ and returns a full path to stdout', parse: (input: string) => stringOrError(input), required: false },
		TTS_PLAY: { desc: 'Shell command that plays an audio file using @WHAT@', parse: (input: string) => stringOrError(input), required: false },
		CAPTURE_START: { desc: 'Shell command to start screen capture', parse: (input: string) => stringOrError(input), required: false },
		CAPTURE_STOP: { desc: 'Shell command to stop screen capture', parse: (input: string) => stringOrError(input), required: false },
	};

	cycles = cycles(this);
	steppers: AStepper[] = [];
	ttsCmd: string;
	ttsPlay: string;
	captureStart: string;
	captureStop: string;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.steppers = steppers;
		this.world = world;
		this.ttsCmd = getStepperOption(this, 'TTS_CMD', world.moduleOptions);
		this.ttsPlay = getStepperOption(this, 'TTS_PLAY', world.moduleOptions);
		this.captureStart = getStepperOption(this, 'CAPTURE_START', world.moduleOptions);
		this.captureStop = getStepperOption(this, 'CAPTURE_STOP', world.moduleOptions);
		if ((this.captureStart && !this.captureStop) || (this.captureStop && !this.captureStart)) {
			throw Error('Capture requires both CAPTURE_START and CAPTURE_STOP');
		}
		return Promise.resolve();
	}

	steps = {
		prose: {
			gwta: '(?<what>.*[.?!])$',
			action: async (_: TStepArgs, featureStep: TFeatureStep) => await this.maybeSay(featureStep.in),
		},
		feature: {
			gwta: 'Feature: {feature}',
			action: async ({ feature }, featureStep: TFeatureStep) => {
				if (Array.isArray(feature)) throw new Error('feature must be string');
				this.getWorld().shared.set('feature', feature as string);
				return await this.maybeSay(featureStep.in);
			},
		},
		[SCENARIO_START]: {
			gwta: 'Scenario: {scenario}',
			action: async ({ scenario }, featureStep: TFeatureStep) => {
				if (Array.isArray(scenario)) throw new Error('scenario must be string');
				this.getWorld().shared.set('scenario', scenario as string);
				return await this.maybeSay(featureStep.in);
			},
		},
		startStepDelay: {
			gwta: 'step delay of {ms:number}ms',
			action: ({ ms }) => {
				this.getWorld().options[STEP_DELAY] = ms as number;
				return OK;
			},
		},
		not: {
			gwta: 'not {what:statement}',
			action: async ({ what }) => {
				const executed = await doExecuteFeatureSteps(what as TFeatureStep[], this.steppers, this.getWorld(), true);
				return executed.ok ? actionNotOK('not statement was true') : OK;
			},
		},
		ifNot: {
			gwta: 'if not {when:statement}, {what:statement}',
			precludes: ['Haibun.if'],
			action: async ({ when, what }) => {
				const whenSteps = when as TFeatureStep[];
				let whenResult: TStepResult | undefined;
				for (const s of whenSteps) {
					whenResult = await FeatureExecutor.doFeatureStep(this.steppers, s, this.getWorld(), true);
					if (!whenResult.ok) break;
				}
				if (whenResult?.ok) return OK; // condition true -> skip what
				const whatSteps = what as TFeatureStep[];
				let lastWhat: TStepResult | undefined;
				for (const s of whatSteps) {
					lastWhat = await FeatureExecutor.doFeatureStep(this.steppers, s, this.getWorld(), true);
					if (!lastWhat.ok) break;
				}
				return lastWhat?.ok ? OK : actionNotOK('if not statement failed');
			},
		},
		if: {
			gwta: 'if {when:statement}, {what:statement}',
			action: async ({ when, what }, featureStep: TFeatureStep) => {
				const whenSteps = when as TFeatureStep[];
				let whenResult: TStepResult | undefined;
				for (const s of whenSteps) {
					whenResult = await FeatureExecutor.doFeatureStep(this.steppers, s, this.getWorld(), true);
					if (!whenResult.ok) break;
				}
				if (!whenResult?.ok) return OK; // condition false => overall step ok
				const whatSteps = what as TFeatureStep[];
				const nestedResults: TStepResult[] = [];
				let lastWhat: TStepResult | undefined;
				const whatOriginal = featureStep.action.stepValuesMap?.what?.original || '';
				const includeNested = whatOriginal.includes('Backgrounds:');
				for (const s of whatSteps) {
					const r = await FeatureExecutor.doFeatureStep(this.steppers, s, this.getWorld(), true);
						nestedResults.push(r);
						lastWhat = r;
						if (!r.ok) break;
				}
				if (includeNested) {
					this.getWorld().runtime.stepResults.push(...nestedResults);
				}
				return lastWhat?.ok ? OK : actionNotOK('if statement failed');
			},
		},
		endsWith: {
			gwta: 'ends with {result}',
			action: ({ result }) => (result as string).toUpperCase() === 'OK' ? actionOK({ messageContext: endExecutonContext }) : actionNotOK('ends with not ok'),
			check: ({ result }: { result: string }) => {
				if (['OK', 'NOT OK'].includes(result.toUpperCase())) return true;
				throw Error('must be "OK" or "not OK"');
			},
		},
			showSteps: {
				exact: 'show steppers',
				action: () => {
				const allSteppers = formattedSteppers(this.steppers);
				this.world?.logger.info(`Steppers: ${JSON.stringify(allSteppers, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { steppers: allSteppers } } });
			}
		},
		until: {
			gwta: 'until {what} is {value}',
			action: async ({ what, value }) => {
				if (Array.isArray(what) || Array.isArray(value)) throw new Error('what/value must be strings');
				while (this.getWorld().shared.get(what as string) !== value) {
					await sleep(100);
				}
				return OK;
			},
		},
		pauseSeconds: {
			gwta: 'pause for {ms}s',
			action: async ({ ms }) => {
				if (Array.isArray(ms)) throw new Error('ms must be string');
				const seconds = parseInt(ms as string, 10) * 1000;
				await sleep(seconds);
				return OK;
			},
		},
		comment: { gwta: ';;{comment}', action: () => OK },
		afterEveryStepper: {
			gwta: 'after every {stepperName}, {line}',
			action: () => OK,
			applyEffect: async ({ stepperName, line }, currentFeatureStep: TFeatureStep, steppers: AStepper[]) => {
				if (Array.isArray(stepperName) || Array.isArray(line)) throw new Error('stepperName/line must be strings');
				const newSteps: TFeatureStep[] = [currentFeatureStep];
				if (currentFeatureStep.action.stepperName === (stepperName as string)) {
					const newFeatureStep = await this.newFeatureFromEffect(line as string, currentFeatureStep.seqPath, steppers);
					newSteps.push(newFeatureStep);
				}
				return newSteps;
			},
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

	async newFeatureFromEffect(content: string, parentSeqPath: number[], steppers: AStepper[]): Promise<TFeatureStep> {
		const features = asFeatures([{ path: `resolved from ${content}`, content }]);
		const expandedFeatures = await expand({ backgrounds: [], features });
		const featureSteps = await new Resolver(steppers).findFeatureSteps(expandedFeatures[0]);
		// first injected child index = 1
		return { ...featureSteps[0], seqPath: [...parentSeqPath, 1] };
	}
}

export default Haibun;
