import { AStepper, IHasCycles, IHasOptions, TStepperSteps } from '../lib/astepper.js';
import { IStepperCycles, TWorld, TBeforeStep, TAfterStep, ExecMode, TAfterStepResult, TFeatureStep } from '../lib/defs.js';
import { TActionResult, OK, TStepResult, TNotOKActionResult, TDebugSignal } from '../schema/protocol.js';
import { makePrompt } from '../lib/prompter.js';
import { actionNotOK, actionOK, formatCurrentSeqPath, getStepperOption, stringOrError } from '../lib/util/index.js';
import { FlowRunner } from '../lib/core/flow-runner.js';

export enum TDebuggingType {
	StepByStep = 'stepByStep',
	Continue = 'continue',
}

const cycles = (debuggerStepper: DebuggerStepper): IStepperCycles => ({
	async beforeStep({ featureStep }: TBeforeStep): Promise<void> {
		if (featureStep.intent?.usage === 'debugging') {
			return;
		}

		if (featureStep.intent?.mode === 'speculative' || featureStep.intent?.usage === 'polling') {
			return;
		}

		const { action } = featureStep;
		if (debuggerStepper.debuggingType === TDebuggingType.StepByStep || debuggerStepper.debugSteppers.includes(action.stepperName)) {
			const prompt = (debuggerStepper.debugSteppers.includes(action.stepperName)) ? `Debugging ${action.stepperName}` : 'Debug';
			debuggerStepper.pendingDebugResult = await debuggerStepper.debugLoop(`${prompt}`, ['*', 'step', 'continue'], featureStep, -1);
		}
	},
	async afterStep({ featureStep, actionResult }: TAfterStep): Promise<TAfterStepResult> {
		if (featureStep.intent?.usage === 'debugging') {
			return;
		}

		if (!actionResult.ok && (featureStep.intent?.mode === 'speculative' || featureStep.intent?.usage === 'polling')) {
			return;
		}
		if (!actionResult.ok) {
			return await debuggerStepper.debugLoop(`[Failure]`, ['*', 'retry', 'next', 'fail'], featureStep, 1);
		}
	}
});
export class DebuggerStepper extends AStepper implements IHasCycles, IHasOptions {
	debuggingType: TDebuggingType = TDebuggingType.Continue;
	cycles: IStepperCycles = cycles(this);
	steppers: AStepper[];
	debugSteppers: string[] = [];
	runner: FlowRunner;
	pendingDebugResult: TAfterStepResult | undefined;

	options = {
		DEBUG_STEPPERS: {
			desc: 'Comma-separated list of steppers to debug',
			parse: stringOrError
		},
	};

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		this.steppers = steppers;
		this.world = world;
		this.runner = new FlowRunner(world, steppers);
		const debugSteppersStart = getStepperOption(this, 'DEBUG_STEPPERS', world.moduleOptions);
		if (debugSteppersStart) {
			for (const stepper of debugSteppersStart.split(',').map(name => name.trim())) {
				if (!this.steppers.some(s => s.constructor.name === stepper)) {
					throw new Error(`DEBUG_STEPPER ${stepper} not found`);
				}
				this.debugSteppers.push(stepper);
			}
		}
		return Promise.resolve();
	}
	async fail(): Promise<TActionResult> {
		return Promise.resolve(actionOK({ controlSignal: 'fail' }));
	}
	async step(): Promise<TActionResult> {
		return Promise.resolve(actionOK({ controlSignal: 'step' }));
	}
	async continue(): Promise<TActionResult> {
		this.debuggingType = TDebuggingType.Continue;
		return Promise.resolve(actionOK({ controlSignal: 'continue' }));
	}

	async debugLoop(prompt: string, prompts: string[], featureStep: TFeatureStep, inc: number): Promise<TAfterStepResult | undefined> {
		const prefix = featureStep.seqPath;
		let seqStart = [...prefix, inc > 0 ? 1 : -1];
		let promptResult: any; // FlowSignal
		let continueLoop = true;
		let controlSignal: TDebugSignal | undefined;

		while (continueLoop) {
			const response = await this.getWorld().prompter.prompt(makePrompt(`${formatCurrentSeqPath(featureStep.seqPath)}-${prompt}`, undefined, prompts));

			// If response is undefined (no prompter available), default to 'continue'
			const responseStr = response === undefined ? 'continue' : response.toString();

			try {
				promptResult = await this.runner.runStatement(responseStr, {
					intent: { mode: 'authoritative', usage: 'debugging' },
					seqPath: seqStart
				});

				// Check for controlSignal (new pattern)
				controlSignal = promptResult.topics?.controlSignal;
				if (controlSignal) {
					continueLoop = false;
				} else {
					const nextLast = seqStart[seqStart.length - 1] + (inc > 0 ? 1 : -1);
					seqStart = [...seqStart.slice(0, -1), nextLast];
				}
			} catch (e) {
				// Debug command failed - continue loop but show error
				this.getWorld().eventLogger.error(`Debug command failed: ${e.message}`);
			}
		}

		// Convert controlSignal to TAfterStepResult
		if (!controlSignal) return undefined;
		return {
			rerunStep: controlSignal === 'retry',
			nextStep: controlSignal === 'next',
			failed: controlSignal === 'fail'
		};
	}
	steps = {
		f: {
			expose: false,
			exact: 'f',
			action: async (): Promise<TActionResult> => {
				return await this.fail();
			},
		},
		fail: {
			exact: 'fail',
			action: async (): Promise<TActionResult> => {
				return await this.fail();
			}
		},
		n: {
			expose: false,
			exact: 'n',
			action: async (): Promise<TActionResult> => {
				return await this.next();
			},
		},
		next: {
			exact: 'next',
			action: async (): Promise<TActionResult> => {
				return await this.next();
			}
		},
		r: {
			expose: false,
			exact: 'r',
			action: async (): Promise<TActionResult> => {
				return await this.retry();
			},
		},
		retry: {
			exact: 'retry',
			action: async (): Promise<TActionResult> => {
				return await this.retry();
			}
		},

		s: {
			expose: false,
			exact: 's',
			action: async (): Promise<TActionResult> => {
				return await this.step();
			},
		},
		step: {
			exact: 'step',
			action: async (): Promise<TActionResult> => {
				return await this.step();
			}
		},
		c: {
			expose: false,
			exact: 'c',
			action: async (): Promise<TActionResult> => {
				return await this.continue();
			},
		},
		continue: {
			exact: 'continue',
			action: async (): Promise<TActionResult> => {
				return await this.continue();
			}
		},
		debugStepByStep: {
			exact: 'debug step by step',
			action: (): Promise<TActionResult> => {
				this.debuggingType = TDebuggingType.StepByStep;
				return Promise.resolve(OK);
			},
		},
		debugStepper: {
			gwta: `debug stepper { stepperName }`,
			action: async ({ stepperName }) => {
				if (Array.isArray(stepperName)) throw new Error('stepperName must be string');
				const stepperNames = (stepperName as string).split(',').map(name => name.trim());
				for (const name of stepperNames) {
					const found = this.steppers.find((s) => s.constructor.name === name);
					if (!found) {
						return Promise.resolve(actionNotOK(`Stepper ${name} not found`));
					}
				}
				this.debugSteppers = this.debugSteppers.concat(stepperNames);
				return Promise.resolve(OK);
			}
		},
		continueStepper: {
			gwta: `continue stepper { stepperName } `,
			action: async ({ stepperName }) => {
				if (Array.isArray(stepperName)) throw new Error('stepperName must be string');
				const stepperNames = (stepperName as string).split(',').map(name => name.trim());
				for (const name of stepperNames) {
					const found = this.steppers.find((s) => s.constructor.name === name);
					if (!found) {
						return Promise.resolve(actionNotOK(`Stepper ${name} not found`));
					}
				}
				this.debugSteppers = this.debugSteppers.filter(name => !stepperNames.includes(name));
				return Promise.resolve(OK);
			}
		}
	} satisfies TStepperSteps;

	async retry(): Promise<TActionResult> {
		return Promise.resolve(actionOK({ controlSignal: 'retry' }));
	}
	async next(): Promise<TActionResult> {
		return Promise.resolve(actionOK({ controlSignal: 'next' }));
	}

	constructor() {
		super();
	}
}

export default DebuggerStepper;
