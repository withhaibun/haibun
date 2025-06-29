import { TStepAction, TResolvedFeature, OK, TExpandedFeature, TStepperStep, TFeatureStep, TExpandedLine } from '../lib/defs.js';
import { AStepper } from '../lib/astepper.js';
import { BASE_TYPES } from '../lib/domain-types.js';
import { namedInterpolation, getMatch } from '../lib/namedVars.js';
import { getActionable, isLowerCase, dePolite, constructorName } from '../lib/util/index.js';

export class Resolver {
	types: string[];

	constructor(private steppers: AStepper[]) {
		this.types = BASE_TYPES;
	}

	public async resolveStepsFromFeatures(features: TExpandedFeature[]) {
		const steps: TResolvedFeature[] = [];
		for (const feature of features) {
			const featureSteps = await this.findFeatureSteps(feature);
			const e = { ...feature, ...{ featureSteps } };
			delete e.expanded;
			steps.push(e);
		}
		return steps;
	}

	public async findFeatureSteps(feature: TExpandedFeature): Promise<TFeatureStep[]> {
		const featureSteps: TFeatureStep[] = [];
		let seq = 0;
		for (const featureLine of feature.expanded) {
			seq++;

			const actionable = getActionable(featureLine.line);

			const actions = this.findActionableSteps(actionable);

			if (actions.length > 1) {
				throw Error(`more than one step found for "${featureLine.line}": ${JSON.stringify(actions.map((a) => a.actionName))}`);
			} else if (actions.length < 1) {
				throw Error(`in ${feature.name}: no step found for ${featureLine.line} in ${feature.path}\nUse --show-steppers for more details`);
			}
			const featureStep = this.getFeatureStep(featureLine, seq, actions[0]);
			featureSteps.push(featureStep);
		}

		return Promise.resolve(featureSteps);
	}

	getFeatureStep(featureLine: TExpandedLine, seq: number, action: TStepAction): TFeatureStep {
		return {
			path: featureLine.feature.path,
			in: featureLine.line,
			seq,
			action,
		};
	}

	public findActionableSteps(actionable: string): TStepAction[] {
		if (!actionable.length) {
			return [comment];
		}
		const found: TStepAction[] = [];

		for (const stepper of this.steppers) {
			const stepperName = constructorName(stepper);
			const { steps } = stepper;
			for (const actionName in steps) {
				const step = steps[actionName];
				const stepFound = this.stepApplies(step, actionable, actionName, stepperName);

				if (stepFound) {
					found.push(stepFound);
				}
			}
		}
		return found;
	}

	private stepApplies(step: TStepperStep, actionable: string, actionName: string, stepperName: string) {
		const curt = dePolite(actionable);
		if (step.gwta) {
			const { str, stepVariables: vars } = namedInterpolation(step.gwta, this.types);
			const f = str.charAt(0);
			const s = isLowerCase(f) ? ['[', f, f.toUpperCase(), ']', str.substring(1)].join('') : str;
			const r = new RegExp(`^${s}`);
			//const r = new RegExp(`^(Given|When|Then|And)?( the )?( I('m)? (am )?)? ?${s}`);
			return getMatch(curt, r, actionName, stepperName, step, vars);
		} else if (step.match) {
			return getMatch(actionable, step.match, actionName, stepperName, step);
		} else if (step.exact === curt) {
			return { actionName, stepperName, step };
		}
	}
	/*   static getPrelude = (path: string, line: string, featureLine: string) => `In '${path}', step '${featureLine}' using '${line}':`;
	 */ static getTypeValidationError = (prelude: string, fileType: string, name: string, typeValidationError: string) =>
		`${prelude} Type '${fileType}' doesn't validate for '${name}': ${typeValidationError}`;
	static getMoreThanOneInclusionError = (prelude: string, fileType: string, name: string) =>
		`${prelude} more than one '${fileType}' inclusion for '${name}'`;
	static getNoFileTypeInclusionError = (prelude: string, fileType: string, name: string) =>
		`${prelude} no '${fileType}' inclusion for '${name}'`;
}

const comment = {
	stepperName: 'Haibun',
	actionName: 'comment',
	step: {
		match: /.*/,
		action: async () => {
			return Promise.resolve(OK);
		},
	},
};

export function getActionableStatement(steppers: AStepper[], statement: string, path: string) {
	const resolver = new Resolver(steppers);
	const action = resolver.findActionableSteps(statement)[0];

	const featureStep: TFeatureStep = {
		path,
		in: statement,
		seq: 0,
		action,
	};

	return { featureStep, steppers };
}
