import { OK, TStepArgs, TFeatureStep, TWorld, IStepperCycles, TStartScenario, Origin, TStepValueValue } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper, IHasCycles } from '../lib/astepper.js';
import { actionNotOK, actionOK } from '../lib/util/index.js';
import { FeatureVariables } from '../lib/feature-variables.js';
import { DOMAIN_STRING } from '../lib/domain-types.js';

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

	// Steps
	steps = {
		combine: {
			gwta: 'combine {p1} and {p2} as {what}',
			action: async ({ p1, p2 }: TStepArgs, featureStep: TFeatureStep) => {
				const label = featureStep.action.stepValuesMap.what.label;
				this.getWorld().shared.set({ label: String(label), value: `${p1}${p2}`, domain: DOMAIN_STRING, origin: Origin.var });
				return Promise.resolve(OK);
			}
		},
		showEnv: {
			gwta: 'show env',
			export: false,
			action: async () => {
				// only available locally since it might contain sensitive info.
				console.info('env', this.world.options.envVariables);
				return Promise.resolve(OK);
			}
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
			action: async (args: TStepArgs, featureStep: TFeatureStep) => {
				const emptyOnly = !!featureStep.in.match(/set empty /);
				const { label, domain, origin } = featureStep.action.stepValuesMap.what;

				if (emptyOnly && this.getWorld().shared.get(label) !== undefined) {
					return OK;
				}

				// Prefer already-populated/coerced runtime arg when available (populateActionArgs runs before step actions)
				if (args && args.value !== undefined) {
					this.getWorld().shared.set({ label: String(label), value: args.value, domain, origin });
					return Promise.resolve(OK);
				}

				// Fallback: coerce raw label
				if (domain !== 'string') {
					const rawValueLabel = featureStep.action.stepValuesMap.value.label;
					const coercedValue = await Promise.resolve(this.getWorld().domains[domain].coerce(rawValueLabel as TStepValueValue, this.steppers));
					this.getWorld().shared.set({ label: String(label), value: coercedValue, domain, origin });
					return Promise.resolve(OK);
				} else {
					this.getWorld().shared.set({ label: String(label), value: featureStep.action.stepValuesMap.value.value, domain, origin });
					return Promise.resolve(OK);
				}
			}
		},
		is: {
			gwta: 'variable {what} is {value}',
			action: ({ value }: TStepArgs, featureStep: TFeatureStep) => {
				console.log('🤑', JSON.stringify(featureStep, null, 2));
				const label = featureStep.action.stepValuesMap?.what?.label as string;
				const val = this.getVarValue(label);

				return val === value ? OK : actionNotOK(`${label} is "${val}", not "${value}"`);
			}
		},
		isSet: {
			precludes: ['VariablesStepper.is'],
			gwta: 'variable {what: string} is set',
			action: ({ what }: TStepArgs) => this.isSet(what as string)
		},
		display: {
			gwta: 'display {what}',
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const stepValue = featureStep.action.stepValuesMap.what;
				this.getWorld().logger.info(`is ${JSON.stringify(stepValue)}`);
				return actionOK({ artifact: { artifactType: 'json', json: { json: stepValue } } });
			}
		},
	};
}

export default VariablesStepper;

export const didNotOverwrite = (what: string, present: string, value: string) => ({
	overwrite: { summary: `did not overwrite ${what} value of "${present}" with "${value}"` },
});
