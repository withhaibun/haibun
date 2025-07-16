import { AStepper, IHasCycles } from '../lib/astepper.js';
import { IStepperCycles, TActionResult, OK, TWorld, TNamed, TBeforeStep, TAfterStep, TAfterStepResult } from '../lib/defs.js';
import { makePrompt } from '../lib/prompter.js';

export enum TDebuggingType {
	StepByStep = 'stepByStep',
	Continue = 'continue',
}

const cycles = (debugerStepper: DebuggerStepper): IStepperCycles => ({
	async beforeStep({ action }: TBeforeStep) {
		if (debugerStepper.debuggingType === TDebuggingType.StepByStep) {
			const response = await debugerStepper.getWorld().prompter.prompt(makePrompt('step or continue', undefined, ['step', 'continue', 's', 'c']));
			if (response === 'continue' || response === 'c') {
				debugerStepper.debuggingType = TDebuggingType.Continue;
			}
		} else if (debugerStepper.debugSteppers.includes(action.stepperName)) {
			const response = await debugerStepper.getWorld().prompter.prompt(makePrompt(`Debugging ${action.stepperName}`, undefined, ['step', 'continue', 's', 'c']));
			if (response === 'continue' || response === 'c') {
				debugerStepper.debugSteppers = debugerStepper.debugSteppers.filter(name => name !== action.stepperName);
			}
		}
		return Promise.resolve();
	},
	async afterStep({ actionResult }: TAfterStep): Promise<TAfterStepResult> {
		if (!actionResult.ok) {
			const response = await debugerStepper.getWorld().prompter.prompt(makePrompt('retry or fail', undefined, ['retry', 'fail', 'r', 'f']));
			if (response === 'retry' || response === 'r') {
				return Promise.resolve({ rerunStep: true });
			}
		}
	}
});

export class DebuggerStepper extends AStepper implements IHasCycles {
	debuggingType: TDebuggingType = TDebuggingType.Continue;
	cycles: IStepperCycles = cycles(this);
	steppers: AStepper[];
	debugSteppers: string[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		this.steppers = steppers;
		this.world = world;
		return Promise.resolve();
	}

	steps = {
		continue: {
			exact: 'continue',
			action: (): Promise<TActionResult> => {
				this.getWorld().logger.info('Continuing execution without debugging');
				this.debuggingType = TDebuggingType.Continue;
				return Promise.resolve(OK);
			}
		},
		exact: {
			exact: 'debug',
			action: async (): Promise<TActionResult> => {
				await this.getWorld().prompter.prompt(makePrompt('step', undefined, ['step', 's']));
				return Promise.resolve(OK);
			},
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
			gwta: `debug stepper {stepperName}`,
			action: async ({ stepperName }: TNamed) => {
				const stepperNames = stepperName.split(',').map(name => name.trim());
				for (const name of stepperNames) {
					const found = this.steppers.find((s) => s.constructor.name === name);
					if (!found) {
						return Promise.reject(new Error(`Stepper ${name} not found`));
					}
				}
				this.debugSteppers = this.debugSteppers.concat(stepperNames);
				return Promise.resolve(OK);
			}
		}
	};

	constructor() {
		super();
	}
}

export default DebuggerStepper;
