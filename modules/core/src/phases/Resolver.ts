import { TStepAction, TResolvedFeature, OK, TExpandedFeature, TStepperStep, TFeatureStep, TExpandedLine, TStepArgs, TStepValue } from '../lib/defs.js';
import { AStepper } from '../lib/astepper.js';
import { BASE_TYPES } from '../lib/domain-types.js';
import { namedInterpolation, getMatch } from '../lib/namedVars.js';
import { getActionable, isLowerCase, dePolite, constructorName } from '../lib/util/index.js';

export class Resolver {
	types: string[];
	verboseResolver: boolean;

	constructor(private steppers: AStepper[]) {
		this.types = BASE_TYPES;
		this.verboseResolver = process && process.env && (process.env.HAIBUN_VERBOSE_RESOLVER === '1' || process.env.HAIBUN_VERBOSE_RESOLVER === 'true');
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

				try {
					const stepAction = this.findSingleStepAction(actionable);
					// Early validation for statement-typed placeholders using their label value
					if (stepAction.stepValuesMap) {
						const statements = Object.values(stepAction.stepValuesMap).filter((v: TStepValue & { label?: string }) => v.domain === 'statement' && v.label);
						for (const ph of statements) {
							const rawVal = ph.label!;
							if (rawVal.trim().startsWith('Backgrounds:')) continue; // skip inline backgrounds directive
							try { this.findSingleStepAction(rawVal); } catch (e) { throw Error(`statement '${rawVal}' invalid: ${e.message}`); }
						}
					}
					const featureStep = this.getFeatureStep(featureLine, seq, stepAction);
					if (stepAction.step.checkAction) {
						const named = Object.fromEntries(Object.entries(stepAction.stepValuesMap || {}).map(([k, v]) => [k, v.value ?? v.label ?? ''])) as TStepArgs;
						const valid = await stepAction.step.checkAction(named, featureStep);
						if (valid === false) throw Error('checkAction failed');
					}
					featureSteps.push(featureStep);
				} catch (e) {
					throw Error(`findFeatureStep for "${featureLine.line}": ${e.message}in ${feature.path}\nUse --show-steppers for more details`);
				}
		}

		return Promise.resolve(featureSteps);
	}
	findSingleStepAction(line: string): TStepAction {
		let stepActions = this.findActionableSteps(line);

		if (stepActions.length > 1) {
			const precludes = stepActions.filter(a => a.step.precludes).map(a => a.step.precludes).reduce((acc, cur) => [...acc, ...cur], []);
			stepActions = stepActions.filter(a => !precludes.includes(`${a.stepperName}.${a.actionName}`));
			if (stepActions.length !== 1) {
				throw Error(`not one step found for "${line}": ${JSON.stringify(stepActions.map((a) => a.actionName))} using precludes ${precludes}`);
			}
		} else if (stepActions.length < 1) {
			throw Error(`no step found for "${line}"`);
		}
		return stepActions[0];
	}

	getFeatureStep(featureLine: TExpandedLine, seq: number, action: TStepAction): TFeatureStep {
		return {
			path: featureLine.feature.path,
			in: featureLine.line,
			seqPath: [seq],
			action,
		};
	}

	public findActionableSteps(actionable: string): TStepAction[] {
		if (!actionable.length) {
			return [comment];
		}
		   const found: TStepAction[] = [];
		   if (process.env.HAIBUN_VERBOSE_RESOLVER === '1') {
			   console.info(`[Resolver] Looking for actionable: '${actionable}'`);
		   }

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
		   if (process.env.HAIBUN_VERBOSE_RESOLVER === '1') {
			   console.info(`[Resolver] Found actions for '${actionable}':`, found.map(f => `${f.stepperName}.${f.actionName}`));
		   }
		   return found;
	}

	private stepApplies(step: TStepperStep, actionable: string, actionName: string, stepperName: string) {
		const curt = dePolite(actionable);
			if (step.gwta) {
					const { regexPattern, stepValuesMap } = namedInterpolation(step.gwta);
			const f = regexPattern.charAt(0);
			const s = isLowerCase(f) ? ['[', f, f.toUpperCase(), ']', regexPattern.substring(1)].join('') : regexPattern;
			const r = new RegExp(`^${s}`);
			// DEBUG: print pattern information to help diagnose matching/capture issues in tests
			if (this.verboseResolver) {
				console.debug('Resolver.stepApplies gwta=', step.gwta);
				console.debug('  regexPattern=', regexPattern);
				console.debug('  transformed=', s);
				console.debug('  regexp=', r);
				console.debug('  actionable=', curt);
			}
			return getMatch(curt, r, actionName, stepperName, step, stepValuesMap);
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

export function getActionableStatement(steppers: AStepper[], statement: string, path: string, startSeq: number, subSeq = 0) {
	const resolver = new Resolver(steppers);
	const action = resolver.findSingleStepAction(statement);

	const featureStep: TFeatureStep = {
		path,
		in: statement,
		seqPath: [startSeq, subSeq],
		action,
	};

	return { featureStep, steppers };
}
