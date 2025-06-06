import { OK, TNamed, TFeatureStep, TWorld, IStepperCycles, TStartScenario } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper } from '../lib/astepper.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';
import { actionNotOK } from '../lib/util/index.js';
import { FeatureVariables } from '../lib/feature-variables.js';

// FIXME see https://github.com/withhaibun/haibun/issues/18
const getOrCond = (fr: string) => fr.replace(/.* is set or /, '');

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

class VariablesStepper extends AStepper {
	cycles = cycles(this);
	set = async (named: TNamed, featureStep: TFeatureStep) => {
		// FIXME see https://github.com/withhaibun/haibun/issues/18
		const emptyOnly = !!featureStep.in.match(/set empty /);

		const res = setShared(named, featureStep, this.getWorld(), emptyOnly);
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
	isSet(what: string, orCond: string) {
		if (this.checkIsSet(what)) {
			return OK;
		}
		const [warning, response] = orCond.split(':').map((t) => t.trim());
		const incident: TMessageContext = {
			incident: EExecutionMessageType.ACTION, incidentDetails: { summary: warning || response, }, tag: this.getWorld().tag
		};

		return actionNotOK(`${what} not set${orCond && ': ' + orCond}`, incident);
	}

	steps = {
		combine: {
			gwta: 'combine {p1} and {p2} as {what}',
			action: async ({ p1, p2, what }: TNamed, featureStep: TFeatureStep) => await this.set({ what, value: `${p1}${p2}` }, featureStep),
		},
		showEnv: {
			gwta: 'show env',
			action: async (n: TNamed, featureStep: TFeatureStep) => {
				console.info('env', this.world.options.envVariables);
				return await this.set(n, featureStep);
			},
		},
		showVars: {
			gwta: 'show vars',
			action: async () => {
				return Promise.resolve(OK);
			},
		},
		set: {
			gwta: 'set( empty)? {what: string} to {value: string}',
			action: async (n: TNamed, featureStep: TFeatureStep) => {
				return await this.set(n, featureStep);
			},
		},
		is: {
			gwta: 'variable {what: string} is "{value}"',
			action: async ({ what, value }: TNamed) => {
				const val = this.getVarValue(what);
				return Promise.resolve(val === value ? OK : actionNotOK(`${what} is "${val}", not "${value}"`));
			},
		},
		isSet: {
			gwta: 'variable {what: string} is set( or .*)?',

			action: async ({ what }: TNamed, featureStep: TFeatureStep) => Promise.resolve(this.isSet(what, getOrCond(featureStep.in))),
		},
		isNotSet: {
			gwta: 'variable {what: string} is not set?',
			action: async ({ what }: TNamed) => this.checkIsSet(what) ? actionNotOK(`${what} is set`) : Promise.resolve(OK),
		},
		background: {
			match: /^Background: ?(?<background>.+)?$/,
			action: async ({ background }: TNamed) => {
				this.getWorld().shared.set('background', background);
				return Promise.resolve(OK);
			},
		},
		display: {
			gwta: 'display {what}',
			action: async ({ what }: TNamed) => {
				this.getWorld().logger.info(`is ${JSON.stringify(what)}`);

				return Promise.resolve(OK);
			},
		},
	};
}

export default VariablesStepper;

export const didNotOverwrite = (what: string, present: string, value: string) => ({
	overwrite: { summary: `did not overwrite ${what} value of "${present}" with "${value}"` },
});

export const setShared = ({ what, value }: TNamed, featureStep: TFeatureStep, world: TWorld, emptyOnly = false) => {
	const { shared } = world;

	if (!emptyOnly || shared.get(what) === undefined) {
		shared.set(what, value);

		return OK;
	}

	return OK;
};
