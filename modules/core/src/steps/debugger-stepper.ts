
import { AStepper } from '../lib/astepper.js';
import { IStepperCycles, TActionResult, OK, TWorld, TNamed, TBeforeStep, TAfterStep, TAfterStepResult } from '../lib/defs.js';

export enum TDebuggingType {
	StepByStep = 'stepByStep',
	Continue = 'continue',
}

const cycles = (stepper: DebuggerStepper): IStepperCycles => ({
	async beforeStep({ action }: TBeforeStep) {
		if (stepper.debuggingType === TDebuggingType.StepByStep) {
			const response = await stepper.getWorld().prompter.prompt({ message: 'step or continue', options: ['step', 'continue', 's', 'c'] });
			if (response === 'continue' || response === 'c') {
				stepper.debuggingType = TDebuggingType.Continue;
			}
		} else if (stepper.debugSteppers.includes(action.stepperName)) {
			const response = await stepper.getWorld().prompter.prompt({ message: `Debugging ${action.stepperName}`, options: ['step', 'continue', 's', 'c'] });
			if (response === 'continue' || response === 'c') {
				stepper.debugSteppers = stepper.debugSteppers.filter(name => name !== action.stepperName);
			}
		}
		return Promise.resolve();
	},
	async afterStep({ actionResult }: TAfterStep): Promise<TAfterStepResult> {
		if (!actionResult.ok) {
			const response = await stepper.getWorld().prompter.prompt({ message: 'retry or fail', options: ['retry', 'fail', 'r', 'f'] });
			if (response === 'retry' || response === 'r') {
				return Promise.resolve({ rerunStep: true });
			}
		}
	}
});

export class DebuggerStepper extends AStepper {
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
				await this.getWorld().prompter.prompt({ message: 'step', options: ['step', 's'] });
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
