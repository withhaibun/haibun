import { resolve } from "path";

import type { TWorld } from "../lib/actuality/domains/world.js";
import { OK, Origin, isPendingScenario } from "../lib/domains/protocol.js";
import { IHasCycles, IHasOptions, AStepper, TFeatureStep, IStepperCycles, TStartFeature, SCENARIO_HEADING, type TStepperSteps } from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOK, getStepperOption, stringOrError } from "../lib/domains/util.js";
import { narratedAudio } from "./pipelines/narration.js";
import { hostSpeech } from "./root.js";
import type { TRenderedAudioMap } from "./ports.js";
import { captureLocator } from "../lib/domains/capture-locator.js";
import { SpeechArtifact, VideoArtifact } from "../lib/domains/protocol.js";
import { DOMAIN_TITLE } from "../lib/domains/domains.js";

/** How long the capture holds the feature's last frame before its stop command runs. */
const CAPTURE_TAIL_MS = 2000;

const cycles = (narrator: Narrator): IStepperCycles => ({
	async startFeature({ resolvedFeature }: TStartFeature) {
		narrator.renderedAudio = await narratedAudio(narrator.speech, resolvedFeature);
		if (narrator.captureStart) {
			narrator.speech.spawn(narrator.captureStart);
		}
	},
	async endFeature() {
		if (narrator.captureStop) {
			await narrator.speech.pause(CAPTURE_TAIL_MS);
			narrator.speech.exec(narrator.captureStop, false);
			const world = narrator.getWorld();
			const path = captureLocator(world.options, world.tag);
			const artifact = VideoArtifact.parse({ id: `narrator.video`, timestamp: Date.now(), kind: "artifact", artifactType: "video", path, mimetype: "video/webm" });
			narrator.getWorld().eventLogger.emit(artifact);
		}
	},
});

class Narrator extends AStepper implements IHasOptions, IHasCycles {
	description = "Text-to-speech narration and screen capture for demos";

	renderedAudio: TRenderedAudioMap = {};
	readonly speech = hostSpeech();
	options = {
		CAPTURE_START: { desc: "Shell command to start screen capture", parse: (input: string) => stringOrError(input), required: false },
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
		prose: { prose: true, precludes: [`Haibun.prose`], action: async (_args: Record<string, never>, featureStep: TFeatureStep) => this.maybeSay(featureStep) },
		feature: {
			precludes: [`Haibun.feature`],
			gwta: `Feature: {feature: ${DOMAIN_TITLE}}`,
			action: async ({ feature }: { feature: string }, featureStep: TFeatureStep) => this.rememberAndSay("feature", feature, featureStep),
		},
		scenario: {
			precludes: [`Haibun.scenario`],
			gwta: SCENARIO_HEADING,
			action: async ({ scenario }: { scenario: string }, featureStep: TFeatureStep) =>
				isPendingScenario(featureStep.in) ? OK : this.rememberAndSay("scenario", scenario, featureStep),
		},
	} as const satisfies TStepperSteps;

	async maybeSay(featureStep: TFeatureStep) {
		const transcript = featureStep.in;
		const world = this.getWorld();
		const dir = captureLocator(world.options, world.tag);
		const { path, durationS } = this.speech.copy(dir, this.renderedAudio, transcript);
		const runtimePath = resolve(dir);

		try {
			const audioFullPath = `${runtimePath}/${path}`;
			await this.speech.play(audioFullPath);
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
