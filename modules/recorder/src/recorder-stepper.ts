/**
 * RecorderStepper - Captures browser interactions and generates .feature files
 */

import { writeFile, appendFile } from "fs/promises";
import { existsSync } from "fs";

import { AStepper, IHasCycles, IHasOptions } from "@haibun/core/lib/astepper.js";
import { OK, TActionResult } from "@haibun/core/schema/protocol.js";
import { TWorld, CycleWhen, TStartFeature } from "@haibun/core/lib/execution.js";
import { actionNotOK, stringOrError, findStepperFromOption } from "@haibun/core/lib/util/index.js";
import { WebPlaywright } from "@haibun/web-playwright";

import { TInteraction, TRecordedStep } from "./types.js";
import { interactionToStep } from "./interaction-mapper.js";
import { instrumentPage } from "./page-instrumentor.js";

const OUTPUT_OPTION = "OUTPUT";
const TITLE_OPTION = "TITLE";

export class RecorderStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "Record browser interactions and generate Haibun .feature files";

	options = {
		[OUTPUT_OPTION]: {
			desc: "Output file path for recorded .feature file",
			parse: (input: string) => stringOrError(input),
		},
		[TITLE_OPTION]: {
			desc: 'Title for the recorded feature (default: "Recorded Session")',
			parse: (input: string) => stringOrError(input),
		},
	};

	cyclesWhen = {
		startFeature: CycleWhen.LAST,
	};

	private recording = false;
	private recordedSteps: TRecordedStep[] = [];
	private outputPath?: string;
	private webPlaywright?: WebPlaywright;
	private lastUrl?: string;

	cycles = {
		startFeature: async ({ resolvedFeature }: TStartFeature): Promise<void> => {
			if (!this.recording) return;

			// Find WebPlaywright stepper to hook into its page
			const steppers = this.getWorld().runtime.steppers as AStepper[] | undefined;
			if (steppers) {
				this.webPlaywright = steppers.find((s): s is WebPlaywright => s.constructor.name === "WebPlaywright");
			}

			if (this.webPlaywright) {
				await this.instrumentCurrentPage();
			}
		},
	};

	private async instrumentCurrentPage(): Promise<void> {
		if (!this.webPlaywright) return;

		try {
			const page = await this.webPlaywright.getPage();

			await instrumentPage(page, (interaction) => {
				this.handleInteraction(interaction);
			});

			// Also capture navigation
			page.on("framenavigated", (frame) => {
				if (frame === page.mainFrame()) {
					const url = frame.url();
					// Avoid duplicate navigation events
					if (url !== this.lastUrl && !url.startsWith("about:")) {
						this.lastUrl = url;
						this.handleInteraction({ type: "navigation", url });
					}
				}
			});

			this.getWorld().eventLogger.info("RecorderStepper: Page instrumented for recording");
		} catch (e) {
			this.getWorld().eventLogger.error(`RecorderStepper: Failed to instrument page: ${e}`);
		}
	}

	private handleInteraction(interaction: TInteraction): void {
		const generatedStep = interactionToStep(interaction);

		const recordedStep: TRecordedStep = {
			timestamp: Date.now(),
			interaction,
			generatedStep,
		};

		this.recordedSteps.push(recordedStep);

		// Log to event logger so monitor-browser can display it
		this.getWorld().eventLogger.info(`[RECORDED] ${generatedStep}`);

		// Append to file in real-time if output path is set
		if (this.outputPath) {
			void this.appendStepToFile(generatedStep);
		}
	}

	private async appendStepToFile(step: string): Promise<void> {
		if (!this.outputPath) return;

		try {
			await appendFile(this.outputPath, step + "\n", "utf-8");
		} catch (e) {
			this.getWorld().eventLogger.error(`RecorderStepper: Failed to write step: ${e}`);
		}
	}

	private async initOutputFile(): Promise<void> {
		if (!this.outputPath) return;

		const title = this.getWorld().moduleOptions[`RECORDERSTEPPER_${TITLE_OPTION}`] || "Recorded Session";
		const header = `${title}.\n\n`;

		try {
			await writeFile(this.outputPath, header, "utf-8");
			this.getWorld().eventLogger.info(`RecorderStepper: Recording to ${this.outputPath}`);
		} catch (e) {
			this.getWorld().eventLogger.error(`RecorderStepper: Failed to create output file: ${e}`);
		}
	}

	steps = {
		startRecording: {
			gwta: "record interactions to {file}",
			action: async ({ file }: { file: string }): Promise<TActionResult> => {
				this.outputPath = String(file);
				this.recording = true;
				this.recordedSteps = [];
				this.lastUrl = undefined;

				await this.initOutputFile();

				// Instrument page if WebPlaywright is already active
				if (this.webPlaywright) {
					await this.instrumentCurrentPage();
				}

				return OK;
			},
		},

		stopRecording: {
			gwta: "stop recording",
			action: (): Promise<TActionResult> => {
				this.recording = false;

				const count = this.recordedSteps.length;
				this.getWorld().eventLogger.info(`RecorderStepper: Stopped recording. ${count} steps captured.`);

				return Promise.resolve(OK);
			},
		},
	};
}

export default RecorderStepper;
