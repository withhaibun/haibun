import { OK, TStepArgs, TFeatureStep, TWorld, IStepperCycles, TStartScenario, Origin, TProvenanceIdentifier } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { actionNotOK, actionOK } from '../lib/util/index.js';
import { FeatureVariables } from '../lib/feature-variables.js';
import { DOMAIN_STRING } from '../lib/domain-types.js';
import { EExecutionMessageType } from '../lib/interfaces/logger.js';

const clearVars = (vars) => async () => {
	vars.getWorld().shared.clear();
	return Promise.resolve();
};

const cycles = (variablesStepper: VariablesStepper): IStepperCycles => ({
	startFeature: clearVars(variablesStepper),
	startScenario: ({ featureVars }: TStartScenario) => {
		variablesStepper.getWorld().shared = new FeatureVariables(variablesStepper.getWorld(), { ...featureVars.all() });
		return Promise.resolve();
	},
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

	steps = {
		combineAs: {
			gwta: 'combine {p1} and {p2} as {domain} to {what}',
			precludes: [`${VariablesStepper.name}.combine`],
			action: ({ p1, p2, domain }: { p1: string, p2: string, domain: string }, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				this.getWorld().shared.set({ term: String(term), value: `${p1}${p2}`, domain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		combine: {
			gwta: 'combine {p1} and {p2} to {what}',
			action: ({ p1, p2 }: TStepArgs, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				this.getWorld().shared.set({ term: String(term), value: `${p1}${p2}`, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		increment: {
			gwta: 'increment {what}',
			action: ({ what }: { what: string }, featureStep: TFeatureStep) => {
				const { term, domain } = featureStep.action.stepValuesMap.what;
				const presentVal = this.getVarValue(term);
				let newVal: number;
				if (presentVal === undefined) {
					newVal = 0;
				} else {
					const numVal = Number(presentVal);
					if (isNaN(numVal)) {
						return actionNotOK(`cannot increment non-numeric variable ${term} with value "${presentVal}"`);
					}
					newVal = numVal + 1;
				}
				this.getWorld().shared.set({ term: String(term), value: newVal, domain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				const messageContext = {
					incident: EExecutionMessageType.ACTION,
					incidentDetails: { json: { incremented: { [term]: newVal } } },
				}
				this.getWorld().logger.info(`incremented ${term} to ${newVal}`, messageContext);
				return Promise.resolve(OK);
			}
		},
		showEnv: {
			gwta: 'show env',
			expose: false,
			action: () => {
				// only available locally since it might contain sensitive info.
				console.info('env', this.world.options.envVariables);
				return Promise.resolve(OK);
			}
		},
		showVars: {
			gwta: 'show vars',
			action: () => {
				console.info('vars', this.getWorld().shared.all());
				return Promise.resolve(actionOK({ artifact: { artifactType: 'json', json: { vars: this.getWorld().shared.all() } } }));
			},
		},
		set: {
			gwta: 'set( empty)? {what: string} to {value: string}',
			precludes: ['Haibun.prose'],
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const emptyOnly = !!featureStep.in.match(/set empty /);
				const { term, domain, origin } = featureStep.action.stepValuesMap.what;

				if (emptyOnly && this.getWorld().shared.get(term) !== undefined) {
					return OK;
				}

				this.getWorld().shared.set({ term: String(term), value: args.value, domain, origin }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		setAs: {
			gwta: 'set( empty)? {what: string} as {domain: string} to {value: string}',
			precludes: [`${VariablesStepper.name}.set`],
			action: ({ value, domain }: { value: string, domain: string }, featureStep: TFeatureStep) => {
				const emptyOnly = !!featureStep.in.match(/set empty /);
				const { term, origin } = featureStep.action.stepValuesMap.what;

				if (emptyOnly && this.getWorld().shared.get(term) !== undefined) {
					return OK;
				}

				this.getWorld().shared.set({ term: String(term), value: value, domain, origin }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		setRandom: {
			precludes: [`${VariablesStepper.name}.set`],
			gwta: `set( empty)? {what: string} to {length: number} random characters`,
			action: ({ length }: { length: number }, featureStep: TFeatureStep) => {
				const emptyOnly = !!featureStep.in.match(/set empty /);
				const { term } = featureStep.action.stepValuesMap.what;

				if (length < 1 || length > 100) {
					return actionNotOK(`length ${length} must be between 1 and 100`);
				}
				if (emptyOnly && this.getWorld().shared.get(term) !== undefined) {
					return OK;
				}

				let rand = '';
				while (rand.length < length) {
					rand += Math.random().toString(36).substring(2, 2 + length);
				}
				rand = rand.substring(0, length);
				this.getWorld().shared.set({ term: String(term), value: rand, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		is: {
			gwta: 'variable {what} is {value}',
			action: ({ what, value }: { what: string, value: string }, featureStep: TFeatureStep) => {
				const { term, domain } = featureStep.action.stepValuesMap.what;
				const val = this.getVarValue(term);
				const asDomain = this.getWorld().domains[domain].coerce({ domain, value, term, origin: 'quoted' })
				return JSON.stringify(val) === JSON.stringify(asDomain) ? OK : actionNotOK(`${term} is ${JSON.stringify(val)}, not ${JSON.stringify(value)}`);
			}
		},
		isSet: {
			precludes: ['VariablesStepper.is'],
			gwta: 'variable {what: string} is set',
			action: ({ what }: TStepArgs, featureStep: TFeatureStep) => {
				// Use term from stepValuesMap when available (normal execution), fall back to what for kireji
				const term = featureStep?.action?.stepValuesMap?.what?.term ?? what;
				return this.isSet(term as string);
			}
		},
		showVar: {
			gwta: 'show var {what}',
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				const stepValue = this.getWorld().shared.all()[term];
				if (!stepValue) {
					this.getWorld().logger.info(`is undefined`);
				} else {
					this.getWorld().logger.info(`is ${JSON.stringify({ ...stepValue, provenance: stepValue.provenance.map((p, i) => ({ [i]: { in: p.in, seq: p.seq.join(','), when: p.when } })) }, null, 2)}`);
				}
				return actionOK({ artifact: { artifactType: 'json', json: { json: stepValue } } });
			}
		},
	} satisfies TStepperSteps;
}

export default VariablesStepper;

export const didNotOverwrite = (what: string, present: string, value: string) => ({
	overwrite: { summary: `did not overwrite ${what} value of "${present}" with "${value}"` },
});

export function provenanceFromFeatureStep(featureStep: TFeatureStep): TProvenanceIdentifier {
	return {
		in: featureStep.in,
		seq: featureStep.seqPath,
		when: `${featureStep.action.stepperName}.steps.${featureStep.action.actionName}`
	};
}

