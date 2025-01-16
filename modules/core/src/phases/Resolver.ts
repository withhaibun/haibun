import { TFound, TResolvedFeature, OK, TWorld, TExpandedFeature, AStepper, TStep, TVStep, TExpandedLine } from '../lib/defs.js';
import { BASE_TYPES } from '../lib/domain-types.js';
import { namedInterpolation, getMatch } from '../lib/namedVars.js';
import { getActionable, describeSteppers, isLowerCase, dePolite, constructorName } from '../lib/util/index.js';

export class Resolver {
	types: string[];

	constructor(private steppers: AStepper[], private world: TWorld) {
		this.types = BASE_TYPES;
	}

	async resolveStepsFromFeatures(features: TExpandedFeature[]) {
		const steps: TResolvedFeature[] = [];
		for (const feature of features) {
			try {
				const vsteps = await this.findVSteps(feature);
				const e = { ...feature, ...{ vsteps } };
				steps.push(e);
			} catch (e) {
				this.world.logger.error(e);
				throw e;
			}
		}
		return steps;
	}

	private async findVSteps(feature: TExpandedFeature): Promise<TVStep[]> {
		let vsteps: TVStep[] = [];
		let seq = 0;
		for (const featureLine of feature.expanded) {
			seq++;

			const actionable = getActionable(featureLine.line);

			const actions = this.findActionableSteps(actionable);

			if (actions.length > 1) {
				throw Error(`more than one step found for "${featureLine.line}": ${JSON.stringify(actions.map((a) => a.actionName))}`);
			} else if (actions.length < 1) {
				throw Error(`no step found for ${featureLine.line} in ${feature.path} from ${describeSteppers(this.steppers)}`);
			}
			const vstep = this.getVStep(featureLine, seq, actions);
			vsteps.push(vstep);
		}

		return vsteps;
	}

	getVStep(featureLine: TExpandedLine, seq: number, actions: TFound[]): TVStep {
		return { source: featureLine.feature, in: featureLine.line, seq, actions };
	}

	public findActionableSteps(actionable: string): TFound[] {
		if (!actionable.length) {
			return [comment];
		}
		const found: TFound[] = [];

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

	private stepApplies(step: TStep, actionable: string, actionName: string, stepperName: string) {
		const curt = dePolite(actionable);
		if (step.gwta) {
			const { str, vars } = namedInterpolation(step.gwta, this.types);
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
			return OK;
		},
	},
};
