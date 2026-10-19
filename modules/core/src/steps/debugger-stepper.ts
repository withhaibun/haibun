import { AStepper, IHasCycles, IHasOptions, TStepperSteps, IStepperCycles, TBeforeStep, TAfterStep, TAfterStepResult, TFeatureStep } from "../lib/steps/domains/stepper.js";
import type { TWorld } from "../lib/actuality/domains/world.js";
import { TActionResult, OK, TDebugSignal } from "../lib/domains/protocol.js";
import { makePrompt } from "../lib/prompts/pipelines/prompter.js";
import { formatSeqPath } from "../lib/actuality/domains/seq-path.js";
import { actionOK, getStepperOption, stringOrError, errorDetail } from "../lib/domains/util.js";
import { nextSeqPath, proveStep, stepperContext } from "../lib/actuality/pipelines/step-dispatch.js";
import { findFeatureStepsFromStatement } from "../lib/actuality/pipelines/resolver.js";
import { itemAt } from "../lib/domains/item-at.js";
import { DOMAIN_STEPPER_NAME } from "../lib/domains/domains.js";

export enum TDebuggingType {
	StepByStep = "stepByStep",
	Continue = "continue",
}

const cycles = (debuggerStepper: DebuggerStepper): IStepperCycles => ({
	async beforeStep({ featureStep }: TBeforeStep): Promise<void> {
		// The debugger pauses before each line. It doesn't pause on its own commands, which are proved as steps, or on a call
		// nested in a line's proof.
		if (debuggerStepper.prompting || featureStep.isSubStep === true || featureStep.programmatic) {
			return;
		}

		const { action } = featureStep;
		if (debuggerStepper.debuggingType === TDebuggingType.StepByStep || debuggerStepper.debugSteppers.includes(action.stepperName)) {
			const prompt = debuggerStepper.debugSteppers.includes(action.stepperName) ? `Debugging ${action.stepperName}` : "Debug";
			debuggerStepper.pendingDebugResult = await debuggerStepper.debugLoop(`${prompt}`, ["*", "step", "continue"], featureStep);
		}
	},
	async afterStep({ featureStep, actionResult }: TAfterStep): Promise<TAfterStepResult | undefined> {
		// A nested call's failure is part of its line's proof, so the debugger stops at the failure of the line.
		if (debuggerStepper.prompting || featureStep.isSubStep === true || featureStep.programmatic) {
			return;
		}
		if (!actionResult.ok) {
			return await debuggerStepper.debugLoop(`[Failure]`, ["*", "retry", "next", "fail"], featureStep);
		}
	},
});
export class DebuggerStepper extends AStepper implements IHasCycles, IHasOptions {
	description = "Interactive debugging with step, continue, retry, and fail commands";

	debuggingType: TDebuggingType = TDebuggingType.Continue;
	cycles: IStepperCycles = cycles(this);
	steppers: AStepper[] = [];
	debugSteppers: string[] = [];
	/** True while a command typed at the prompt is proved. */
	prompting = false;
	pendingDebugResult: TAfterStepResult | undefined;

	options = { DEBUG_STEPPERS: { desc: "Comma-separated list of steppers to debug", parse: stringOrError } };

	setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		this.steppers = steppers;
		this.world = world;
		const debugSteppersStart = getStepperOption(this, "DEBUG_STEPPERS", world.moduleOptions) as string | undefined;
		if (debugSteppersStart) {
			for (const stepper of debugSteppersStart.split(",").map((name) => name.trim())) {
				if (!this.steppers.some((s) => s.constructor.name === stepper)) {
					throw new Error(`DEBUG_STEPPER names ${stepper}, which isn't a loaded stepper; name one of ${this.steppers.map((s) => s.constructor.name).join(", ")}`);
				}
				this.debugSteppers.push(stepper);
			}
		}
		return Promise.resolve();
	}
	fail(): Promise<TActionResult> {
		return Promise.resolve(actionOK({ controlSignal: "fail" }));
	}
	step(): Promise<TActionResult> {
		return Promise.resolve(actionOK({ controlSignal: "step" }));
	}
	continue(): Promise<TActionResult> {
		this.debuggingType = TDebuggingType.Continue;
		return Promise.resolve(actionOK({ controlSignal: "continue" }));
	}

	async debugLoop(prompt: string, prompts: string[], featureStep: TFeatureStep): Promise<TAfterStepResult | undefined> {
		const world = this.getWorld();
		let controlSignal: TDebugSignal | undefined;

		while (controlSignal === undefined) {
			const response = await world.prompter.prompt(makePrompt(`${formatSeqPath(featureStep.seqPath)}-${prompt}`, undefined, prompts));

			// If response is undefined (a prompter isn't available), default to 'continue'
			const responseStr = response === undefined ? "continue" : response.toString();

			this.prompting = true;
			try {
				const command = itemAt(findFeatureStepsFromStatement(responseStr, this.steppers, world, featureStep.source?.path, [0]), 0);
				const promptResult = await proveStep(stepperContext(world, this.steppers), { ...command, seqPath: nextSeqPath(world, featureStep.seqPath), isSubStep: true });
				controlSignal = promptResult.controlSignal;
			} catch (e) {
				// Debug command failed - continue loop but show error
				world.eventLogger.error(`Debug command failed: ${errorDetail(e)}`);
			} finally {
				this.prompting = false;
			}
		}

		return { rerunStep: controlSignal === "retry", nextStep: controlSignal === "next", failed: controlSignal === "fail" ? "failed at the debugger" : undefined };
	}
	steps = {
		f: {
			exact: "f",
			action: async (): Promise<TActionResult> => {
				return await this.fail();
			},
		},
		fail: {
			exact: "fail",
			action: async (): Promise<TActionResult> => {
				return await this.fail();
			},
		},
		n: {
			exact: "n",
			action: async (): Promise<TActionResult> => {
				return await this.next();
			},
		},
		next: {
			exact: "next",
			action: async (): Promise<TActionResult> => {
				return await this.next();
			},
		},
		r: {
			exact: "r",
			action: async (): Promise<TActionResult> => {
				return await this.retry();
			},
		},
		retry: {
			exact: "retry",
			action: async (): Promise<TActionResult> => {
				return await this.retry();
			},
		},

		s: {
			exact: "s",
			action: async (): Promise<TActionResult> => {
				return await this.step();
			},
		},
		step: {
			exact: "step",
			action: async (): Promise<TActionResult> => {
				return await this.step();
			},
		},
		c: {
			exact: "c",
			action: async (): Promise<TActionResult> => {
				return await this.continue();
			},
		},
		continue: {
			exact: "continue",
			action: async (): Promise<TActionResult> => {
				return await this.continue();
			},
		},
		debugStepByStep: {
			exact: "debug step by step",
			action: (): Promise<TActionResult> => {
				this.debuggingType = TDebuggingType.StepByStep;
				return Promise.resolve(OK);
			},
		},
		debugStepper: {
			gwta: `debug stepper {stepperName: ${DOMAIN_STEPPER_NAME}}`,
			action: ({ stepperName }: { stepperName: string }) => {
				this.debugSteppers.push(stepperName);
				return Promise.resolve(OK);
			},
		},
		continueStepper: {
			gwta: `continue stepper {stepperName: ${DOMAIN_STEPPER_NAME}}`,
			action: ({ stepperName }: { stepperName: string }) => {
				this.debugSteppers = this.debugSteppers.filter((name) => name !== stepperName);
				return Promise.resolve(OK);
			},
		},
	} as const satisfies TStepperSteps;

	retry(): Promise<TActionResult> {
		return Promise.resolve(actionOK({ controlSignal: "retry" }));
	}
	next(): Promise<TActionResult> {
		return Promise.resolve(actionOK({ controlSignal: "next" }));
	}

	constructor() {
		super();
	}
}

export default DebuggerStepper;
