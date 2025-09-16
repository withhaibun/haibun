import { OK, TStepArgs, TFeatureStep, TWorld, IStepperCycles, TStartScenario } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper, IHasCycles } from '../lib/astepper.js';
import { actionNotOK, actionOK } from '../lib/util/index.js';
import { DOMAIN_STRING } from '../lib/domain-types.js';
import { FeatureVariables } from '../lib/feature-variables.js';

const clearVars = (vars) => async () => {
	vars.getWorld().shared.clear();
	return Promise.resolve();
};

const cycles = (variablesStepper: VariablesStepper): IStepperCycles => ({
	startFeature: clearVars(variablesStepper),
	startScenario: ({ featureVars }: TStartScenario) => {
		variablesStepper.getWorld().shared = new FeatureVariables(variablesStepper.getWorld().tag.toString(), { ...featureVars.all() });
		return Promise.resolve();
	},
	endScenario: clearVars(variablesStepper),
});

class VariablesStepper extends AStepper implements IHasCycles {
	cycles = cycles(this);
	steppers: AStepper[];
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
		this.steppers = steppers;
		await Promise.resolve();
	}
	set = (args: TStepArgs, featureStep: TFeatureStep) => {
		const emptyOnly = !!featureStep.in.match(/set empty /);
		// Always treat the variable name as the label, not a resolved env/var value.
		const what = featureStep.action.stepValuesMap.what.label;
		const { domains, shared } = this.getWorld();
		if (emptyOnly && shared.get(what) !== undefined) return OK;
		const label = featureStep.action.stepValuesMap.what.label;
		const domain = featureStep.action.stepValuesMap.what.domain;
		const value = domains[domain].coerce(label, this.steppers);
		console.log('f🤑', JSON.stringify(value, null, 2));
		shared.set({ label: what, value, domain, origin: 'literal' });
		return OK;
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
			action: async ({ p1, p2 }: TStepArgs, featureStep: TFeatureStep) => {
				const label = featureStep.action.stepValuesMap.what.label;
				const what = (label !== undefined ? label : featureStep.action.stepValuesMap?.what?.value) as string;
				return await this.set({ what, value: `${p1 as string}${p2 as string}` }, featureStep);
			}
		},
		showEnv: {
			gwta: 'show env', export: false,
			action: async (args: TStepArgs, featureStep: TFeatureStep) => { console.info('env', this.world.options.envVariables); return await this.set(args, featureStep); }
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
			action: async (args: TStepArgs, featureStep: TFeatureStep) => await this.set(args, featureStep)
		},
		is: {
			gwta: 'variable {what: string} is "{value}"',
			action: ({ what, value }: TStepArgs) => {
				const val = this.getVarValue(what as string);
				return val === value ? OK : actionNotOK(`${what as string} is "${val}", not "${value}"`);
			}
		},
		isSet: {
			gwta: 'variable {what: string} is set',
			action: ({ what }: TStepArgs) => this.isSet(what as string)
		},
		display: {
			gwta: 'display {what}',
			action: ({ what }: TStepArgs) => {
				this.getWorld().logger.info(`is ${JSON.stringify(what)}`);
				return actionOK({ artifact: { artifactType: 'json', json: { [what as string]: this.getVarValue(what as string) } } });
			}
		},
	};
}

export default VariablesStepper;

export const didNotOverwrite = (what: string, present: string, value: string) => ({
	overwrite: { summary: `did not overwrite ${what} value of "${present}" with "${value}"` },
});
