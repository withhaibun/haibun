import { AStepper, IHasCycles, IHasOptions } from '../lib/astepper.js';
import { IStepperCycles, TActionResult, OK, TWorld, TNamed, TBeforeStep, TAfterStep, TAfterStepResult, TStepResult } from '../lib/defs.js';
import { TMessageContext, EExecutionMessageType } from '../lib/interfaces/logger.js';
import { makePrompt } from '../lib/prompter.js';
import { actionNotOK, actionOK, getStepperOption, stringOrError } from '../lib/util/index.js';
import { resolveAndExecuteStatement } from '../lib/util/resolveAndExecuteStatement.js';

export enum TDebuggingType {
	StepByStep = 'stepByStep',
	Continue = 'continue',
}

const cycles = (debuggerStepper: DebuggerStepper): IStepperCycles => ({
	async beforeStep({ featureStep }: TBeforeStep) {
		const { action } = featureStep;
		if (debuggerStepper.debuggingType === TDebuggingType.StepByStep || debuggerStepper.debugSteppers.includes(action.stepperName)) {
			const prompt = (debuggerStepper.debugSteppers.includes(action.stepperName)) ? `[Debugging ${action.stepperName}]` : '[Debug]';
			return debuggerStepper.debugLoop(prompt, ['step', 'continue', '*']);
		}
	},
	async afterStep({ actionResult }: TAfterStep): Promise<TAfterStepResult> {
		if (!actionResult.ok) {
			return await debuggerStepper.debugLoop('[Failure]', ['*', 'retry', 'fail']);
		}
	}
});

export class DebuggerStepper extends AStepper implements IHasCycles, IHasOptions {
	debuggingType: TDebuggingType = TDebuggingType.Continue;
	cycles: IStepperCycles = cycles(this);
	steppers: AStepper[];
	debugSteppers: string[] = [];

	options = {
		DEBUG_STEPPERS: {
			desc: 'Comma-separated list of steppers to debug',
			parse: stringOrError
		},
	};

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		this.steppers = steppers;
		this.world = world;
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
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { fail: true } }; // this will fall through
		return Promise.resolve(actionOK({ messageContext }));
	}
	async retry(): Promise<TActionResult> {
		this.getWorld().logger.info('retry');
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { rerunStep: true } }; // will trigger rerun in Executor
		return Promise.resolve(actionOK({ messageContext }));
	}
	async step(): Promise<TActionResult> {
		this.getWorld().logger.info('step');
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { step: true } }; // will fall through
		return Promise.resolve(actionOK({ messageContext }));
	}
	async continue(): Promise<TActionResult> {
		this.getWorld().logger.info('Continuing execution without debugging');
		this.debuggingType = TDebuggingType.Continue;
		const messageContext: TMessageContext = { incident: EExecutionMessageType.DEBUG, incidentDetails: { continue: true } }; // will fall through
		return Promise.resolve(actionOK({ messageContext }));
	}

	async debugLoop(prompt: string, prompts: string[]) {
		let postFailurePromptResult: TStepResult | undefined;
		while (postFailurePromptResult === undefined || postFailurePromptResult.stepActionResult.messageContext?.incident !== EExecutionMessageType.DEBUG) {
			const response = await this.getWorld().prompter.prompt(makePrompt(prompt, undefined, prompts));
			try {
				postFailurePromptResult = await resolveAndExecuteStatement(response.toString(), 'debugger', this.steppers, this.getWorld());
			} catch (e) {
				this.getWorld().logger.error(`Failed to execute post - failure action: ${e.message}`);
			}
		}
		return postFailurePromptResult.stepActionResult.messageContext?.incidentDetails;
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
			action: async ({ stepperName }: TNamed) => {
				const stepperNames = stepperName.split(',').map(name => name.trim());
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
			action: async ({ stepperName }: TNamed) => {
				const stepperNames = stepperName.split(',').map(name => name.trim());
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
	};

	constructor() {
		super();
	}
}

export default DebuggerStepper;
