
import { AStepper } from '../lib/astepper.js';
import { IStepperCycles, TStartStep, TActionResult, OK } from '../lib/defs.js';

export enum TDebuggingType {
	StepByStep = 'stepByStep',
	BreakPoint = 'breakPoint',
	Continue = 'continue',
}

const cycles = (stepper: DebuggerStepper): IStepperCycles => ({
	async startStep(startStep: TStartStep) {
		if (stepper.debuggingType === TDebuggingType.StepByStep) {
			const { featureStep } = startStep;
			stepper.getWorld().logger.info(`About to execute step: ${featureStep.in}`);
			await stepper.getWorld().prompter.prompt({ message: 'Press Enter to continue...' });
		}
		return Promise.resolve();
	},
});

export class DebuggerStepper extends AStepper {
	debuggingType: TDebuggingType = TDebuggingType.Continue;
	cycles: IStepperCycles = cycles(this);

	steps = {
		continue: {
			gwta: 'continue',
			action: (): Promise<TActionResult> => {
				this.getWorld().logger.info('Continuing execution without debugging');
				this.debuggingType = TDebuggingType.Continue;
				return Promise.resolve(OK);
			}
		},
		debug: {
			gwta: 'debug step by step',
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
