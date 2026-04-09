import {
	TStepAction,
	TResolvedFeature,
	TExpandedFeature,
	TStepperStep,
	TFeatureStep,
	TExpandedLine,
	TFeatures,
	TWorld,
	TFeature,
} from "../lib/defs.js";
import { TStepValue, FEATURE_START, SCENARIO_START } from "../schema/protocol.js";
import { AStepper } from "../lib/astepper.js";
import { matchGwtaToAction, getMatch } from "../lib/namedVars.js";
import { getActionable, dePolite, constructorName, actionNotOK } from "../lib/util/index.js";
import { expandLine } from "../lib/features.js";

export class Resolver {
	public backgroundWarnings: { path: string; line: string; error: string }[] = [];

	constructor(
		private steppers: AStepper[],
		private backgrounds: TFeatures = [],
	) {
		// Process backgrounds to allow steppers to register metadata (e.g., waypoint statements)
		for (const background of backgrounds) {
			const lines = background.content.split("\n");
			const actualSourcePath = background.base && background.path ? background.base + background.path : undefined;
			for (let i = 0; i < lines.length; i++) {
				const actionable = getActionable(lines[i]);
				if (!this.callResolveFeatureLine(actionable, background.path, lines, i, actualSourcePath)) {
					if (!actionable) {
						continue;
					}
					try {
						this.findSingleStepAction(actionable);
					} catch (e) {
						// Instead of throwing, collect warnings for LSP tolerance
						this.backgroundWarnings.push({
							path: background.path,
							line: lines[i],
							error: e.message,
						});
					}
				}
			}
		}
	}

	private callResolveFeatureLine(
		line: string,
		path: string,
		allLines?: string[],
		lineIndex?: number,
		actualSourcePath?: string,
	): boolean {
		for (const stepper of this.steppers) {
			for (const step of Object.values(stepper.steps)) {
				if (step.resolveFeatureLine) {
					const shouldSkip = step.resolveFeatureLine(line, path, stepper, this.backgrounds, allLines, lineIndex, actualSourcePath);
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
			// Notify steppers to clear feature-scoped steps before resolving each feature
			this.startFeatureResolution(feature.path);
			const featureSteps = await this.findFeatureSteps(feature);
			const e = { ...feature, ...{ featureSteps } };
			delete e.expanded;
			steps.push(e);
		}
		return steps;
	}

	/**
	 * Notify steppers that we're starting to resolve a new feature.
	 * This allows steppers to clear feature-scoped steps that shouldn't leak between features.
	 */
	private startFeatureResolution(path: string) {
		for (const stepper of this.steppers) {
			if (typeof stepper.startFeatureResolution === "function") {
				stepper.startFeatureResolution(path);
			}
		}
	}

	public async findFeatureSteps(feature: TExpandedFeature): Promise<TFeatureStep[]> {
		const { steps, errors } = await this.findFeatureStepsTolerant(feature);
		if (errors.length > 0) {
			const firstError = errors[0];
			throw Error(
				`findFeatureStep for "${firstError.featureLine.line}": ${firstError.error.message} in ${feature.path}\nUse --show-steppers for more details`,
			);
		}
		return steps.filter((s) => s.action.stepperName !== "Directive");
	}

	public findFeatureStepsTolerant(
		feature: TExpandedFeature,
	): Promise<{ steps: TFeatureStep[]; errors: { featureLine: TExpandedLine; error: Error }[] }> {
		return Promise.resolve(this.findFeatureStepsTolerantSync(feature));
	}

	public findFeatureStepsTolerantSync(feature: TExpandedFeature): {
		steps: TFeatureStep[];
		errors: { featureLine: TExpandedLine; error: Error }[];
	} {
		const steps: TFeatureStep[] = [];
		const errors: { featureLine: TExpandedLine; error: Error }[] = [];
		const allLines = feature.expanded.map((fl) => fl.line);
		let seq = 0;
		let inCodeBlock = false;
		for (let i = 0; i < feature.expanded.length; i++) {
			const featureLine = feature.expanded[i];
			const line = featureLine.line.trim();
			if (line.startsWith("```")) {
				inCodeBlock = !inCodeBlock;
				continue;
			}
			if (inCodeBlock) {
				continue;
			}

			const actionable = getActionable(featureLine.line);
			const actualSourcePath =
				featureLine.feature?.base && featureLine.feature?.path ? featureLine.feature.base + featureLine.feature.path : undefined;

			if (this.callResolveFeatureLine(actionable, feature.path, allLines, i, actualSourcePath)) {
				steps.push({
					source: {
						path: actualSourcePath || feature.path,
						lineNumber: featureLine.lineNumber,
					},
					in: featureLine.line,
					seqPath: [seq],
					action: {
						stepperName: "Directive",
						actionName: "directive",
						step: { exact: actionable, action: async () => ({ ok: true }) },
					},
				});
				continue;
			}

			if (!actionable) {
				continue;
			}

			seq++;

			try {
				const stepAction = this.findSingleStepAction(actionable);

				if (stepAction.actionName === FEATURE_START || stepAction.actionName === SCENARIO_START) {
					seq = 0;
				}

				if (stepAction.stepValuesMap) {
					const statements = Object.values(stepAction.stepValuesMap).filter(
						(v: TStepValue & { label?: string }) => v.domain === "statement" && v.term,
					);
					for (const ph of statements) {
						const rawVal = ph.term as string;
						try {
							this.callResolveFeatureLine(rawVal, feature.path);
							this.findSingleStepAction(rawVal);
						} catch (e) {
							throw Error(`statement '${rawVal}' invalid: ${e.message}`);
						}
					}
				}

				const featureStep = this.getFeatureStep(featureLine, seq, stepAction);
				steps.push(featureStep);
			} catch (e) {
				errors.push({ featureLine, error: e });
			}
		}
		return { steps, errors };
	}
	findSingleStepAction(line: string): TStepAction {
		let stepActions = this.findActionableSteps(line);

		if (stepActions.length > 1) {
			const unique = stepActions.filter((a) => a.step.unique);
			if (unique.length === 1) {
				return unique[0];
			}
			// Filter out fallback steps if there are non-fallback alternatives
			const nonFallback = stepActions.filter((a) => !a.step.fallback);
			if (nonFallback.length > 0) {
				stepActions = nonFallback;
			}
			// If still multiple matches, use precludes
			if (stepActions.length > 1) {
				const precludes = stepActions
					.filter((a) => a.step.precludes)
					.map((a) => a.step.precludes)
					.reduce((acc, cur) => [...acc, ...cur], []);
				stepActions = stepActions.filter((a) => !precludes.includes(`${a.stepperName}.${a.actionName}`));
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
		// For virtual steps (like waypoints), use the step's source location if available
		const step = action.step;
		const lineNumber = step?.source?.lineNumber ?? featureLine.lineNumber;
		const path = step?.source?.path ?? featureLine.feature.base + featureLine.feature.path;
		return {
			source: {
				path,
				lineNumber,
			},
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
			const gwtaStartsWithPlaceholder = step.gwta.startsWith("{");

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

export function getActionableStatement(
	steppers: AStepper[],
	statement: string,
	path: string,
	seqPath: number[],
	lineNumber?: number,
) {
	const resolver = new Resolver(steppers);
	const action = resolver.findSingleStepAction(statement);
	const step = action.step;

	const featureStep: TFeatureStep = {
		source: {
			path: step?.source?.path || path,
			lineNumber: step?.source?.lineNumber ?? lineNumber,
		},
		in: statement,
		seqPath,
		action,
	};

	return { featureStep, steppers };
}

export function findFeatureStepsFromStatement(
	statement: string,
	steppers: AStepper[],
	world: TWorld,
	base: string,
	seqStart: number[],
	inc = 1,
): TFeatureStep[] {
	const featureSteps: TFeatureStep[] = [];
	if (!world.runtime.backgrounds) {
		throw new Error("runtime.backgrounds is undefined; cannot expand inline Backgrounds");
	}
	// For expandLine, we need to provide a feature context. If the statement is a Backgrounds: directive,
	// expandLine will ignore this feature and use the actual background files. If it's a regular statement,
	// expandLine will use this feature's path. So we pass the base (feature path) here.
	// Note: 'base' parameter is actually the full path, so we set feature.base to it and feature.path to empty
	const contextFeature: TFeature = { path: "", base, name: "statement-context", content: statement };
	const expanded = expandLine(statement, undefined, world.runtime.backgrounds, contextFeature);
	// Increment the last segment of seqStart by inc for each expanded step
	const prefix = seqStart.slice(0, -1);
	let latest = seqStart[seqStart.length - 1];
	for (const x of expanded) {
		const seqPath = [...prefix, latest];
		const fullPath = x.feature.base + x.feature.path;
		try {
			const { featureStep } = getActionableStatement(steppers, x.line, fullPath, seqPath, x.lineNumber);
			latest += inc;
			featureSteps.push(featureStep);
		} catch (e) {
			featureSteps.push({
				source: {
					path: fullPath,
					lineNumber: x.lineNumber,
				},
				in: x.line,
				seqPath,
				action: {
					actionName: "error",
					stepperName: "Resolver",
					step: {
						action: async () => actionNotOK(e.message),
					},
				},
			});
		}
	}
	return featureSteps;
}
