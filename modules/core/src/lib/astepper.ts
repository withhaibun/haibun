import { TWorld, IStepperCycles, TStepperStep, TOptionValue, TEnvVariables } from './defs.js';
import { TAnyFixme } from './fixme.js';
import { constructorName } from './util/index.js';

export abstract class AStepper {
	world?: TWorld;
	async setWorld(world: TWorld, _steppers: AStepper[]) {
		this.world = world;
		// some steppers like to keep a reference to all steppers
		void _steppers;
		await Promise.resolve();
	}
	abstract steps: TStepperSteps;
	getWorld() {
		if (!this.world) {
			throw Error(`stepper without world ${constructorName(this)}`);
		}

		return this.world;
	}
}
export type TStepperSteps = {
	[key: string]: TStepperStep;
};
export interface IHasOptions {
	options?: {
		[name: string]: {
			required?: boolean;
			// alternate for the literal option
			altSource?: string;
			default?: string;
			desc: string;
			parse: (input: string, existing?: TOptionValue) => { parseError?: string; env?: TEnvVariables; result?: TAnyFixme; };
		};
	};
}

export interface IHasCycles {
	cycles: IStepperCycles;
}
