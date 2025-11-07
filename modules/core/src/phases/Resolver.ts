import { TStepAction, TResolvedFeature, OK, TExpandedFeature, TStepperStep, TFeatureStep, TExpandedLine, TStepValue, TFeatures } from '../lib/defs.js';
import { AStepper } from '../lib/astepper.js';
import { matchGwtaToAction, getMatch } from '../lib/namedVars.js';
import { getActionable, dePolite, constructorName } from '../lib/util/index.js';
import { findFeatures } from '../lib/features.js';
import { ActivitiesStepper } from '../steps/activities-stepper.js';

export class Resolver {
	constructor(private steppers: AStepper[], private backgrounds: TFeatures = []) {
		this.registerActivitiesFromSources(backgrounds);
	}

	private registerActivitiesFromSources(sources: TFeatures | TExpandedFeature[]): void {
		const activitiesStepper = this.steppers.find(s => s instanceof ActivitiesStepper) as ActivitiesStepper | undefined;
		if (!activitiesStepper) {
			return; // No ActivitiesStepper, skip outcome registration
		}

		// Process each source (background or feature) to find remember statements
		for (const source of sources) {
			// Check if this is an expanded feature (has 'expanded' property) vs a background feature file
			const lines = 'expanded' in source
				? source.expanded.map(fl => fl.line)
				: source.content.trim().split('\n');

			for (const line of lines) {
				const actionable = getActionable(typeof line === 'string' ? line : line);
				const rememberMatch = actionable.match(/^remember\s+(.+?)\s+with\s+(.+?)(?:\s+forgets\s+(.+))?$/i);
				if (rememberMatch) {
					const outcome = rememberMatch[1].trim();
					const proofStatement = rememberMatch[2].trim();
					const forgets = rememberMatch[3]?.trim();

					activitiesStepper.registerOutcome(outcome, [proofStatement], source.path, forgets);
				}
			}
		}
	}

	private validateBackgroundsPattern(rawStatement: string): void {
		if (!rawStatement.match(/^Backgrounds:\s*/i)) {
			return;
		}

		const names = rawStatement.replace(/^Backgrounds:\s*/i, '').trim();
		const bgNames = names.split(',').map((a) => a.trim());

		for (const bgName of bgNames) {
			const bg = findFeatures(bgName, this.backgrounds);
			if (bg.length !== 1) {
				throw new Error(`can't find single "${bgName}.feature" from ${this.backgrounds.map((b) => b.path).join(', ')}`);
			}
		}
	}

	public async resolveStepsFromFeatures(features: TExpandedFeature[]) {
		// First pass: register all Activities/remember statements from all features
		this.registerActivitiesFromSources(features);

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

			// Skip remember statements - they're processed in registerActivitiesFromSources()
			if (actionable.match(/^remember\s+(.+?)\s+with\s+(.+?)(?:\s+forgets\s+(.+))?$/i)) {
				continue;
			}

			try {
				const stepAction = this.findSingleStepAction(actionable);

				// Validate Backgrounds: statements during Resolve (not just in DOMAIN_STATEMENT)
				this.validateBackgroundsPattern(actionable);

				// stepValuesMap is attached to stepAction for downstream processing
				// Early validation for statement-typed placeholders using their label value
				if (stepAction.stepValuesMap) {
					const statements = Object.values(stepAction.stepValuesMap).filter((v: TStepValue & { label?: string }) => v.domain === 'statement' && v.term);
					for (const ph of statements) {
						const rawVal = ph.term!;
						try {
							this.findSingleStepAction(rawVal);
							this.validateBackgroundsPattern(rawVal);
						} catch (e) {
							throw Error(`statement '${rawVal}' invalid: ${e.message}`);
						}
					}
				}

				const featureStep = this.getFeatureStep(featureLine, seq, stepAction);
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
			const unique = stepActions.filter(a => a.step.unique);
			if (unique.length === 1) {
				return unique[0];
			}
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
			return matchGwtaToAction(step.gwta, curt, actionName, stepperName, step);
		} else if (step.match) {
			return getMatch(actionable, step.match, actionName, stepperName, step);
		} else if (step.exact === curt) {
			return { actionName, stepperName, step };
		}
	}
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

export function getActionableStatement(steppers: AStepper[], statement: string, path: string, seqPath: number[]) {
	const resolver = new Resolver(steppers);
	const action = resolver.findSingleStepAction(statement);

	const featureStep: TFeatureStep = {
		path,
		in: statement,
		seqPath,
		action,
	};

	return { featureStep, steppers };
}
