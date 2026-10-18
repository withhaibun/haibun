/**
 * RecorderStepper - Captures browser interactions and generates .feature files
 */
import { AStepper, IHasCycles, IHasOptions, CycleWhen, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { OK, TActionResult } from "@haibun/core/lib/domains/protocol.js";
import { errorDetail, stringOrError } from "@haibun/core/lib/util/index.js";
import type { WebPlaywright } from "@haibun/web-playwright";
import { DOMAIN_FILE_PATH } from "@haibun/core/lib/domains/domains.js";
import { startRecording, type TRecording } from "./pipelines/recording.js";
import { recordingPorts } from "./root.js";

const OUTPUT_OPTION = "OUTPUT";
const TITLE_OPTION = "TITLE";
const WEB_PLAYWRIGHT = "WebPlaywright";

export class RecorderStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "Record browser interactions and generate Haibun .feature files";

	options = {
		[OUTPUT_OPTION]: { desc: "Output file path for recorded .feature file", parse: (input: string) => stringOrError(input) },
		[TITLE_OPTION]: { desc: 'Title for the recorded feature (default: "Recorded Session")', parse: (input: string) => stringOrError(input) },
	};

	cyclesWhen = { startFeature: CycleWhen.LAST };

	private recording?: TRecording;
	private webPlaywright?: WebPlaywright;

	cycles = {
		startFeature: async (): Promise<void> => {
			if (!this.recording) return;
			const steppers = this.getWorld().runtime.steppers as AStepper[] | undefined;
			this.webPlaywright = steppers?.find((s): s is WebPlaywright => s.constructor.name === WEB_PLAYWRIGHT);
			await this.instrumentCurrentPage();
		},
	};

	/** Captures the interactions of web-playwright's page, where web-playwright runs. */
	private async instrumentCurrentPage(): Promise<void> {
		if (!this.webPlaywright || !this.recording) return;
		try {
			await this.recording.instrument(await this.webPlaywright.getPage());
		} catch (e) {
			this.getWorld().eventLogger.error(`RecorderStepper: Failed to instrument page: ${errorDetail(e)}`);
		}
	}

	steps = {
		startRecording: {
			gwta: `record interactions to {file: ${DOMAIN_FILE_PATH}}`,
			action: async ({ file }: { file: string }): Promise<TActionResult> => {
				const title = this.getWorld().moduleOptions[`RECORDERSTEPPER_${TITLE_OPTION}`] || "Recorded Session";
				this.recording = await startRecording(recordingPorts(this.getWorld().eventLogger), String(file), title);
				await this.instrumentCurrentPage();
				return OK;
			},
		},

		stopRecording: {
			gwta: "stop recording",
			action: (): Promise<TActionResult> => {
				const count = this.recording ? this.recording.steps.length : 0;
				this.recording = undefined;
				this.getWorld().eventLogger.info(`RecorderStepper: Stopped recording. ${count} steps captured.`);
				return Promise.resolve(OK);
			},
		},
	} as const satisfies TStepperSteps;
}

export default RecorderStepper;
