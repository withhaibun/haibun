/**
 * A recording of a page's interactions as a feature file: each interaction becomes the step that reproduces it, logged and
 * appended to the file as it happens. A navigation to the address the page is at, or to an `about:` page, isn't recorded.
 */
import type { Page } from "playwright";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import type { TInteraction, TRecordedStep } from "../domains/interaction.js";
import { interactionToStep } from "../derivations/interaction-step.js";
import type { TRecordingPorts } from "../ports.js";

/** The prefix of an address the browser shows without a page. */
const BLANK_SCHEME = "about:";

/** A recording in progress: what it captured, and the page it captures. */
export type TRecording = { steps: TRecordedStep[]; instrument(page: Page): Promise<void> };

/** Starts a recording to the feature file at `path`, titled `title`. */
export async function startRecording(ports: TRecordingPorts, path: string, title: string): Promise<TRecording> {
	const { pages, file, clock, log } = ports;
	await file.start(path, title).catch((e: unknown) => log.error(`RecorderStepper: Failed to create output file: ${errorDetail(e)}`));
	log.info(`RecorderStepper: Recording to ${path}`);
	const steps: TRecordedStep[] = [];
	let lastUrl: string | undefined;
	const record = (interaction: TInteraction): void => {
		if (interaction.type === "navigation") {
			if (interaction.url === lastUrl || interaction.url.startsWith(BLANK_SCHEME)) return;
			lastUrl = interaction.url;
		}
		const generatedStep = interactionToStep(interaction);
		steps.push({ timestamp: clock.now(), interaction, generatedStep });
		log.info(`[RECORDED] ${generatedStep}`);
		void file.append(path, generatedStep).catch((e: unknown) => log.error(`RecorderStepper: Failed to write step: ${errorDetail(e)}`));
	};
	return {
		steps,
		async instrument(page) {
			await pages.instrument(page, record);
			log.info("RecorderStepper: Page instrumented for recording");
		},
	};
}
