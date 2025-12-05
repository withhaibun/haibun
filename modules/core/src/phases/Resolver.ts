import { TStepAction, TResolvedFeature, OK, TExpandedFeature, TStepperStep, TFeatureStep, TExpandedLine, TStepValue, TFeatures, TWorld, TFeature } from '../lib/defs.js';
import { AStepper } from '../lib/astepper.js';
import { matchGwtaToAction, getMatch, namedInterpolation } from '../lib/namedVars.js';
import { getActionable, dePolite, constructorName } from '../lib/util/index.js';
import { expandLine } from '../lib/features.js';

export class Resolver {
	constructor(private steppers: AStepper[], private backgrounds: TFeatures = []) {
		// Process backgrounds to allow steppers to register metadata (e.g., waypoint statements)
		for (const background of backgrounds) {
			const lines = background.content.trim().split('\n');
			for (let i = 0; i < lines.length; i++) {
				const actionable = getActionable(lines[i]);
				if (!this.callResolveFeatureLine(actionable, background.path, lines, i)) {
					try {
						this.findSingleStepAction(actionable);
					} catch (e) {
						throw Error(`Background resolution error for "${lines[i]}" in ${background.path}: ${e.message}`);
					}
				}
			}
		}
	}

	private callResolveFeatureLine(line: string, path: string, allLines?: string[], lineIndex?: number): boolean {
		for (const stepper of this.steppers) {
			for (const step of Object.values(stepper.steps)) {
				if (step.resolveFeatureLine) {
					const shouldSkip = step.resolveFeatureLine(line, path, stepper, this.backgrounds, allLines, lineIndex);
					if (shouldSkip) {
						return true;
					}
				}
			}
		}
		return false;
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
		const allLines = feature.expanded.map(fl => fl.line);
		let seq = 0;
		let inCodeBlock = false;
		for (let i = 0; i < feature.expanded.length; i++) {
			const featureLine = feature.expanded[i];
			const line = featureLine.line.trim();
			if (line.startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				continue;
			}
			if (inCodeBlock) {
				continue;
			}

			seq++;

			const actionable = getActionable(featureLine.line);

			// Give steppers a chance to handle special resolution logic
			if (this.callResolveFeatureLine(actionable, feature.path, allLines, i)) {
				continue;
			}

			try {
				const stepAction = this.findSingleStepAction(actionable);

				// stepValuesMap is attached to stepAction for downstream processing
				// Early validation for statement-typed placeholders using their label value
				if (stepAction.stepValuesMap) {
					const statements = Object.values(stepAction.stepValuesMap).filter((v: TStepValue & { label?: string }) => v.domain === 'statement' && v.term);
					for (const ph of statements) {
						const rawVal = ph.term!;
						try {
							// Also give steppers a chance to validate nested statements
							this.callResolveFeatureLine(rawVal, feature.path);
							this.findSingleStepAction(rawVal);
						} catch (e) {
							throw Error(`statement '${rawVal}' invalid: ${e.message}`);
						}
					}
				}

				const featureStep = this.getFeatureStep(featureLine, seq, stepAction);
				featureSteps.push(featureStep);
			} catch (e) {
				// If the original line starts with Uppercase, treat it as Prose and ignore the error
				// This handles cases where "The ensure..." is matched as "ensure" but fails nested validation
				const originalLine = featureLine.line.trim();
				if (/^[A-Z]/.test(originalLine) && (e.message.startsWith('no step found') || e.message.startsWith('statement'))) {
					continue;
				}
				throw Error(`findFeatureStep for "${featureLine.line}": ${e.message} in ${feature.path}\nUse --show-steppers for more details`);
			}
		} return Promise.resolve(featureSteps);
	}
	findSingleStepAction(line: string): TStepAction {
		let stepActions = this.findActionableSteps(line);

		if (stepActions.length > 1) {
			const unique = stepActions.filter(a => a.step.unique);
			if (unique.length === 1) {
				return unique[0];
			}
			// Filter out fallback steps if there are non-fallback alternatives
			const nonFallback = stepActions.filter(a => !a.step.fallback);
			if (nonFallback.length > 0) {
				stepActions = nonFallback;
			}
			// If still multiple matches, use precludes
			if (stepActions.length > 1) {
				const precludes = stepActions.filter(a => a.step.precludes).map(a => a.step.precludes).reduce((acc, cur) => [...acc, ...cur], []);
				stepActions = stepActions.filter(a => !precludes.includes(`${a.stepperName}.${a.actionName}`));
			}
			if (stepActions.length !== 1) {
				throw Error(`not one step found for "${line}": ${JSON.stringify(stepActions.map((a) => a.actionName))}`);
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
			// Enforce that if the input starts with Uppercase, the GWTA must also start with Uppercase.
			// This distinguishes "Prose" (Uppercase) from "steps" (Lowercase).
			// Exception: patterns starting with {variable} placeholders can match any input.
			const startsWithUpper = /^[A-Z]/.test(curt);
			const gwtaStartsUpper = /^[A-Z]/.test(step.gwta);
			const gwtaStartsWithPlaceholder = step.gwta.startsWith('{');

			if (startsWithUpper && !gwtaStartsUpper && !gwtaStartsWithPlaceholder) {
				return undefined;
			}
			return matchGwtaToAction(step.gwta, curt, actionName, stepperName, step);
		} else if (step.match) {
			return getMatch(actionable, step.match, actionName, stepperName, step);
		} else if (step.exact === curt) {
			return { actionName, stepperName, step };
		}
	}
}

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

export function findFeatureStepsFromStatement(statement: string, steppers: AStepper[], world: TWorld, base: string, seqStart: number[], inc = 1): TFeatureStep[] {
	const featureSteps: TFeatureStep[] = [];
	if (!world.runtime.backgrounds) {
		throw new Error('runtime.backgrounds is undefined; cannot expand inline Backgrounds');
	}
	// For expandLine, we need to provide a feature context. If the statement is a Backgrounds: directive,
	// expandLine will ignore this feature and use the actual background files. If it's a regular statement,
	// expandLine will use this feature's path. So we pass the base (feature path) here.
	const contextFeature: TFeature = { path: base, base, name: 'statement-context', content: statement };
	const expanded = expandLine(statement, world.runtime.backgrounds, contextFeature);
	// Increment the last segment of seqStart by inc for each expanded step
	const prefix = seqStart.slice(0, -1);
	let latest = seqStart[seqStart.length - 1];
	for (const x of expanded) {
		const seqPath = [...prefix, latest];
		try {
			const { featureStep } = getActionableStatement(steppers, x.line, x.feature.path, seqPath);
			latest += inc;
			featureSteps.push(featureStep);
		} catch (e) {
			featureSteps.push({
				path: x.feature.path,
				in: x.line,
				seqPath,
				action: {
					actionName: 'error',
					stepperName: 'Resolver',
					step: {
						action: async () => ({ ok: false, message: e.message })
					}
				}
			});
		}
	}
	return featureSteps;
}
