import { AStepper, IHasCycles, IHasOptions, TStepperSteps } from '../lib/astepper.js';
import { IStepperCycles, TActionResult, OK, TWorld, TBeforeStep, TAfterStep, TStepResult, ExecMode, TAfterStepResult, TFeatureStep } from '../lib/defs.js';
import { TMessageContext, EExecutionMessageType } from '../lib/interfaces/logger.js';
import { makePrompt } from '../lib/prompter.js';
import { actionNotOK, actionOK, formatCurrentSeqPath, getStepperOption, stringOrError } from '../lib/util/index.js';
import { FlowRunner } from '../lib/core/flow-runner.js';

export enum TDebuggingType {
	StepByStep = 'stepByStep',
	Continue = 'continue',
}

const cycles = (debuggerStepper: DebuggerStepper): IStepperCycles => ({
	async beforeStep({ featureStep }: TBeforeStep) {
		// Skip debugging for debug commands themselves to avoid infinite recursion
		if (featureStep.intent?.usage === 'debugging') {
			return { featureStep };
		}

		// Skip debugging for speculative and polling steps (expected to possibly fail)
		if (featureStep.intent?.mode === 'speculative' || featureStep.intent?.usage === 'polling') {
			return { featureStep };
		}

		const { action } = featureStep;
		if (debuggerStepper.debuggingType === TDebuggingType.StepByStep || debuggerStepper.debugSteppers.includes(action.stepperName)) {
			const prompt = (debuggerStepper.debugSteppers.includes(action.stepperName)) ? `Debugging ${action.stepperName}` : 'Debug';
			return debuggerStepper.debugLoop(`${prompt}`, ['*', 'step', 'continue'], featureStep, -1);
		}
	},
	async afterStep({ featureStep, actionResult }: TAfterStep): Promise<TAfterStepResult> {
		// Skip debugging for debug commands themselves to avoid infinite recursion
		if (featureStep.intent?.usage === 'debugging') {
			return;
		}

		debuggerStepper.getWorld().logger.debug(`afterStep ${featureStep.in} ok=${actionResult.ok} intent=${JSON.stringify(featureStep.intent)}`);

		if (!actionResult.ok && (featureStep.intent?.mode === 'speculative' || featureStep.intent?.usage === 'polling')) {
			debuggerStepper.getWorld().logger.debug(`Skipping debugger for speculative/polling failure: ${featureStep.in} intent=${JSON.stringify(featureStep.intent)}`);
			return;
		}
		if (!actionResult.ok) {
			debuggerStepper.getWorld().logger.debug(`Debugger triggering for failure: ${featureStep.in} intent=${JSON.stringify(featureStep.intent)}`);
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
			this.getWorld().logger.info(`Debugging steppers: ${this.debugSteppers.join(', ')}`);
		}
		return Promise.resolve();
	}
	async fail(): Promise<TActionResult> {
		this.getWorld().logger.info('fail');
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { failed: true } };
		return Promise.resolve(actionOK({ messageContext }));
	}
	async step(): Promise<TActionResult> {
		this.getWorld().logger.info('step');
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { step: true } };
		return Promise.resolve(actionOK({ messageContext }));
	}
	async continue(): Promise<TActionResult> {
		this.getWorld().logger.info('Continuing execution without debugging');
		this.debuggingType = TDebuggingType.Continue;
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { continue: true } };
		return Promise.resolve(actionOK({ messageContext }));
	}

	async debugLoop(prompt: string, prompts: string[], featureStep: TFeatureStep, inc: number) {
		const prefix = featureStep.seqPath;
		let seqStart = [...prefix, inc > 0 ? 1 : -1];
		let promptResult: any; // FlowSignal
		let continueLoop = true;

		while (continueLoop) {
			const response = await this.getWorld().prompter.prompt(makePrompt(`${formatCurrentSeqPath(featureStep.seqPath)}-${prompt}`, undefined, prompts));

			// If response is undefined (no prompter available), default to 'continue'
			const responseStr = response === undefined ? 'continue' : response.toString();

			try {
				promptResult = await this.runner.runStatement(responseStr, {
					intent: { mode: 'authoritative', usage: 'debugging' },
					seqPath: seqStart
				});

				const details = promptResult.payload?.messageContext?.incidentDetails;
				if (details?.step || details?.continue || details?.failed || details?.rerunStep || details?.nextStep) {
					continueLoop = false;
				} else {
					const nextLast = seqStart[seqStart.length - 1] + (inc > 0 ? 1 : -1);
					seqStart = [...seqStart.slice(0, -1), nextLast];
				}
			} catch (e) {
				this.getWorld().logger.error(`Failed to execute debug prompt command '${responseStr}': ${e.message}`);
			}
		}
		return promptResult?.payload?.messageContext?.incidentDetails;
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
				this.getWorld().logger.info('Executing debug step');
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
		this.getWorld().logger.info('retry');
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { rerunStep: true } }; // will trigger rerun in Executor
		return Promise.resolve(actionOK({ messageContext }));
	}
	async next(): Promise<TActionResult> {
		this.getWorld().logger.info('next');
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { nextStep: true } }; // will trigger next step in Executor
		return Promise.resolve(actionOK({ messageContext }));
	}

	constructor() {
		super();
	}
}

export default DebuggerStepper;
