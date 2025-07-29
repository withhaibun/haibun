import { TStepAction, TResolvedFeature, OK, TExpandedFeature, TStepperStep, TFeatureStep, TExpandedLine } from '../lib/defs.js';
import { AStepper } from '../lib/astepper.js';
import { BASE_TYPES } from '../lib/domain-types.js';
import { namedInterpolation, getMatch, getNamedToVars } from '../lib/namedVars.js';
import { getActionable, isLowerCase, dePolite, constructorName } from '../lib/util/index.js';
import { getDefaultWorld } from '../lib/test/lib.js';

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

	public async findFeatureSteps(feature: TExpandedFeature, world = getDefaultWorld(0)): Promise<TFeatureStep[]> {
		const featureSteps: TFeatureStep[] = [];
		let seq = 0;
		for (const featureLine of feature.expanded) {
			seq++;

			const actionable = getActionable(featureLine.line);

			let stepActions = this.findActionableSteps(actionable);

			if (stepActions.length > 1) {
				const precludes = stepActions.filter(a => a.step.precludes).map(a => a.step.precludes).reduce((acc, cur) => [...acc, ...cur], []);
				stepActions = stepActions.filter(a => !precludes.includes(`${a.stepperName}.${a.actionName}`));
				if (stepActions.length !== 1) {
					throw Error(`not one step found for "${featureLine.line}": ${JSON.stringify(stepActions.map((a) => a.actionName))} using precludes ${precludes}`);
				}
			} else if (stepActions.length < 1) {
				throw Error(`in ${feature.name}: no step found for ${featureLine.line} in ${feature.path}\nUse --show-steppers for more details`);
			}
			const stepAction = stepActions[0];
			const featureStep = this.getFeatureStep(featureLine, seq, stepAction);
			if (stepAction.step.check) { //throws if it fails
				const namedWithVars = getNamedToVars(stepAction, world, featureStep);
				await stepAction.step.check(namedWithVars, featureStep);
			}
			console.log('wtw');

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
