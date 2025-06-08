
import { AStepper } from '../lib/astepper.js';
import { IStepperCycles, TActionResult, OK } from '../lib/defs.js';

export enum TDebuggingType {
	StepByStep = 'stepByStep',
	Continue = 'continue',
}

const cycles = (stepper: DebuggerStepper): IStepperCycles => ({
	async beforeStep() {
		if (stepper.debuggingType === TDebuggingType.StepByStep) {
			const response = await stepper.getWorld().prompter.prompt({ message: 'step or continue', options: ['step', 'continue', 's', 'c'] });
			if (response === 'continue' || response === 'c') {
				stepper.debuggingType = TDebuggingType.Continue;
			}
		}
		return Promise.resolve();
	},
});

export class DebuggerStepper extends AStepper {
	debuggingType: TDebuggingType = TDebuggingType.Continue;
	cycles: IStepperCycles = cycles(this);

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
			gwta: 'debug',
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
	};

	constructor() {
		super();
	}
}

export default DebuggerStepper;
