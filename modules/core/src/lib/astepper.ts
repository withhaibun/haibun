import { TWorld, IStepperCycles, TStepperStep, TOptionValue, TEnvVariables, TExecutorResult } from './defs.js';
import { TAnyFixme } from './fixme.js';
import { constructorName } from './util/index.js';

export abstract class AStepper {
	world?: TWorld;
	cycles?: IStepperCycles;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
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
export type TStepperSteps = Record<string, TStepperStep>;

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

export interface IProcessFeatureResults extends AStepper {
	processFeatureResult: (executorResult: TExecutorResult) => Promise<void>;
}

export const isProcessFeatureResults = (s: AStepper): s is IProcessFeatureResults => (<IProcessFeatureResults>s).processFeatureResult !== undefined;
