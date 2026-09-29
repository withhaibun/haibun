import { resolve } from "path";

import type { TWorld } from "../lib/world.js";
import { Origin } from "../schema/protocol.js";
import { IHasCycles, IHasOptions, AStepper, TFeatureStep, IStepperCycles, TStartFeature, type TStepperSteps } from "../lib/astepper.js";
import { actionNotOK, actionOK, getStepperOption, sleep, stringOrError } from "../lib/util/index.js";
import { actualURI } from "../lib/util/node/actualURI.js";
import { copyPreRenderedAudio, doExec, doSpawn, playAudioFile, preRenderFeatureProse, TRenderedAudioMap } from "./lib/tts.js";
import { captureLocator } from "../lib/capture-locator.js";
import { SpeechArtifact, VideoArtifact } from "../schema/protocol.js";
import { DOMAIN_TITLE } from "../lib/domains.js";

const CAPTURE_FILENAME = "vcapture.webm";

const cycles = (narrator: Narrator): IStepperCycles => ({
	async startFeature({ resolvedFeature }: TStartFeature) {
		narrator.renderedAudio = await preRenderFeatureProse(resolvedFeature);
		if (narrator.captureStart) {
			doSpawn(narrator.captureStart);
		}
	},
	async endFeature() {
		if (narrator.captureStop) {
			actualURI(CAPTURE_FILENAME);
			await sleep(2000);
			await doExec(narrator.captureStop, false);
			const world = narrator.getWorld();
			const path = captureLocator(world.options, world.tag);
			const artifact = VideoArtifact.parse({
				id: `narrator.video`,
				timestamp: Date.now(),
				kind: "artifact",
				artifactType: "video",
				path,
				mimetype: "video/webm",
			});
			narrator.getWorld().eventLogger.emit(artifact);
		}
	},
});

class Narrator extends AStepper implements IHasOptions, IHasCycles {
	description = "Text-to-speech narration and screen capture for demos";

	renderedAudio: TRenderedAudioMap = {};
	options = {
		CAPTURE_START: {
			desc: "Shell command to start screen capture",
			parse: (input: string) => stringOrError(input),
			required: false,
		},
		CAPTURE_STOP: { desc: "Shell command to stop screen capture", parse: (input: string) => stringOrError(input), required: false },
	};

	cycles = cycles(this);
	steppers: AStepper[] = [];
	captureStart: string | undefined;
	captureStop: string | undefined;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.captureStart = getStepperOption(this, "CAPTURE_START", world.moduleOptions) as string | undefined;
		this.captureStop = getStepperOption(this, "CAPTURE_STOP", world.moduleOptions) as string | undefined;
	}

	private async rememberAndSay(key: string, value: string, featureStep: TFeatureStep) {
		await this.getWorld().shared.set(
			{ term: key, value, domain: "string", origin: Origin.defined },
			{ in: featureStep.in, seq: featureStep.seqPath, when: `${featureStep.action.stepperName}.${featureStep.action.actionName}` },
		);
		return this.maybeSay(featureStep);
	}

	steps = {
		prose: {
			prose: true,
			precludes: [`Haibun.prose`],
			action: async (_args: Record<string, never>, featureStep: TFeatureStep) => this.maybeSay(featureStep),
		},
		feature: {
			precludes: [`Haibun.feature`],
			gwta: `Feature: {feature: ${DOMAIN_TITLE}}`,
			action: async ({ feature }: { feature: string }, featureStep: TFeatureStep) => this.rememberAndSay("feature", feature, featureStep),
		},
		scenario: {
			precludes: [`Haibun.scenario`],
			gwta: `Scenario: {scenario: ${DOMAIN_TITLE}}`,
			action: async ({ scenario }: { scenario: string }, featureStep: TFeatureStep) => this.rememberAndSay("scenario", scenario, featureStep),
		},
	} as const satisfies TStepperSteps;

	async maybeSay(featureStep: TFeatureStep) {
		const transcript = featureStep.in;
		const world = this.getWorld();
		const dir = captureLocator(world.options, world.tag);
		const { path, durationS } = copyPreRenderedAudio(dir, this.renderedAudio, transcript);
		const runtimePath = resolve(dir);

		try {
			const audioFullPath = `${runtimePath}/${path}`;
			await playAudioFile(audioFullPath);
		} catch (error: unknown) {
			const e = error as { message: string; stderr?: unknown };
			const stderr = e.stderr ? String(e.stderr) : "";
			return actionNotOK(`Error playing audio: ${e.message}\nOutput: ${stderr}`);
		}

		const artifact = SpeechArtifact.parse({
			id: `narrator.speech`,
			timestamp: Date.now(),
			kind: "artifact",
			artifactType: "speech",
			path,
			mimetype: "audio/mpeg",
			transcript,
			durationS,
		});
		this.getWorld().eventLogger.emit(artifact);
		return actionOK();
	}
}

export default Narrator;
