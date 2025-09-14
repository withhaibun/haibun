import { OK, TStepArgs, TFeatureStep, TWorld, IStepperCycles, TStartScenario } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper, IHasCycles } from '../lib/astepper.js';
import { actionNotOK, actionOK } from '../lib/util/index.js';
import { FeatureVariables } from '../lib/feature-variables.js';

const clearVars = (vars) => async () => {
	vars.getWorld().shared.clear()
	return Promise.resolve();
}

const cycles = (variablesStepper: VariablesStepper): IStepperCycles => ({
	endScenario: clearVars(variablesStepper),
	startFeature: clearVars(variablesStepper),
	startScenario: ({ featureVars }: TStartScenario) => {
		variablesStepper.getWorld().shared = new FeatureVariables(variablesStepper.getWorld().tag.toString(), { ...featureVars.all() });
		return Promise.resolve();
	},
});

class VariablesStepper extends AStepper implements IHasCycles {
	cycles = cycles(this);
	set = async (named: TStepArgs, featureStep: TFeatureStep) => {
		// FIXME see https://github.com/withhaibun/haibun/issues/18
		const emptyOnly = !!featureStep.in.match(/set empty /);
		if (Array.isArray(named.what) || Array.isArray(named.value)) throw new Error('what/value must be strings');
		const res = setShared(named as TStepArgs, featureStep, this.getWorld(), emptyOnly);
		return Promise.resolve(res);
	};
	checkIsSet(what: string,) {
		return this.getVarValue(what) !== undefined;
	}
	// FIXME provide explicit mapping to more carefully handle env, etc.
	private getVarValue(what: string): TAnyFixme {
		const envVal = this.getWorld().options.envVariables[what];
		if (envVal !== undefined) {
			return envVal;
		}
		return this.getWorld().shared.get(what);
	}
	isSet(what: string) {
		if (this.checkIsSet(what)) {
			return OK;
		}
		return actionNotOK(`${what} not set`);
	}

	steps = {
		combine: {
			gwta: 'combine {p1} and {p2} as {what}',
			action: async ({ p1, p2, what }: TStepArgs, featureStep: TFeatureStep) => {
				if (Array.isArray(p1) || Array.isArray(p2) || Array.isArray(what)) throw new Error('p1/p2/what must be strings');
				return await this.set({ what: what as string, value: `${p1 as string}${p2 as string}` }, featureStep);
			},
		},
		showEnv: {
			gwta: 'show env',
			export: false,
			action: async (n: TStepArgs, featureStep: TFeatureStep) => {
				console.info('env', this.world.options.envVariables);
				return await this.set(n, featureStep);
			},
		},
		showVars: {
			gwta: 'show vars',
			action: async () => {
				console.info('vars', this.getWorld().shared.all());
				return Promise.resolve(actionOK({ artifact: { artifactType: 'json', json: { vars: this.getWorld().shared.all() } } }));
			},
		},
		set: {
			gwta: 'set( empty)? {what: string} to {value: string}',
			action: async (n: TStepArgs, featureStep: TFeatureStep) => {
				return await this.set(n, featureStep);
			},
		},
		is: {
			gwta: 'variable {what: string} is "{value}"',
			action: async ({ what, value }: TStepArgs) => {
				if (Array.isArray(what) || Array.isArray(value)) throw new Error('what/value must be strings');
				const val = this.getVarValue(what as string);
				return Promise.resolve(val === value ? OK : actionNotOK(`${what as string} is "${val}", not "${value}"`));
			},
		},
		isSet: {
			gwta: 'variable {what: string} is set',
			action: async ({ what }: TStepArgs) => {
				if (Array.isArray(what)) throw new Error('what must be string');
				return Promise.resolve(this.isSet(what as string));
			},
		},
		isNotSet: {
			gwta: 'variable {what: string} is not set',
			action: async ({ what }: TStepArgs) => {
				if (Array.isArray(what)) throw new Error('what must be string');
				return this.checkIsSet(what as string) ? actionNotOK(`${what as string} is set`) : Promise.resolve(OK);
			},
		},
		display: {
			gwta: 'display {what}',
			action: async ({ what }: TStepArgs) => {
				if (Array.isArray(what)) throw new Error('what must be string');
				this.getWorld().logger.info(`is ${JSON.stringify(what)}`);
				return Promise.resolve(actionOK({ artifact: { artifactType: 'json', json: { [what as string]: this.getVarValue(what as string) } } }));
			},
		},
	};
}

export default VariablesStepper;

export const didNotOverwrite = (what: string, present: string, value: string) => ({
	overwrite: { summary: `did not overwrite ${what} value of "${present}" with "${value}"` },
});

export const setShared = ({ what, value }: TStepArgs, featureStep: TFeatureStep, world: TWorld, emptyOnly = false) => {
	if (Array.isArray(what) || Array.isArray(value)) throw new Error('what/value must be strings');
	const { shared } = world;

	if (!emptyOnly || shared.get(what as string) === undefined) {
		shared.set(what as string, value as string);

		return OK;
	}

	return OK;
};
