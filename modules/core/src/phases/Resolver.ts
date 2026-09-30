import type { TExpandedFeature, TExpandedLine, TFeatures, TFeature } from "../lib/execution.js";
import type { TWorld } from "../lib/world.js";
import { TStepValue, FEATURE_START, SCENARIO_START, Origin } from "../schema/protocol.js";
import { AStepper, TStepAction, TResolvedFeature, TStepperStep, TFeatureStep } from "../lib/astepper.js";
import { matchGwtaToAction, getMatch } from "../lib/namedVars.js";
import { getActionable, dePolite, constructorName, actionNotOK, asError, errorDetail } from "../lib/util/index.js";
import { itemAt } from "../lib/util/item-at.js";
import { DOMAIN_STATEMENT } from "../lib/domains.js";
import { expandLine } from "../lib/features.js";

/** A line written as a sentence: a capital first letter and a final `.`, `!`, `?`, `:` or `;`. */
const SENTENCE = /^[A-Z].*[.!?:;]$/;
/** A line that starts with a character other than a letter, such as a heading, a list item, a table row or a link. */
const STARTS_WITH_NON_LETTER = /^[^a-zA-Z]/;
/** Whether a step's pattern starts with a capital, as a heading's does. */
const writtenCapitalized = (step: TStepperStep) => /^[A-Z]/.test(step.gwta ?? step.exact ?? "");

export class Resolver {
	public backgroundWarnings: { path: string; line: string; error: string }[] = [];

	/**
	 * @param offers which steps a line may resolve to, where a caller holds only some: undefined, every step.
	 */
	constructor(
		private steppers: AStepper[],
		private backgrounds: TFeatures = [],
		private offers?: (stepperName: string, actionName: string, step: TStepperStep) => boolean,
	) {
		// Process backgrounds to allow steppers to register metadata (e.g., waypoint statements)
		for (const background of backgrounds) {
			const lines = background.content.split("\n");
			const actualSourcePath = background.base && background.path ? background.base + background.path : undefined;
			for (const [i, line] of lines.entries()) {
				const actionable = getActionable(line);
				if (!this.callResolveFeatureLine(actionable, background.path, lines, i, actualSourcePath)) {
					if (!actionable) {
						continue;
					}
					try {
						this.findSingleStepAction(actionable);
					} catch (e) {
						// Collect as a warning rather than throwing, for LSP tolerance
						this.backgroundWarnings.push({
							path: background.path,
							line,
							error: errorDetail(e),
						});
					}
				}
			}
		}
	}

	private callResolveFeatureLine(line: string, path: string, allLines?: string[], lineIndex?: number, actualSourcePath?: string): boolean {
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
			const { expanded: _expanded, ...resolved } = feature;
			steps.push({ ...resolved, featureSteps });
		}
		return steps;
	}

	/** Notify steppers that a new feature is being resolved, letting them clear feature-scoped steps that must not leak between features. */
	private startFeatureResolution(path: string) {
		for (const stepper of this.steppers) {
			if (typeof stepper.startFeatureResolution === "function") {
				stepper.startFeatureResolution(path);
			}
		}
	}

	public async findFeatureSteps(feature: TExpandedFeature): Promise<TFeatureStep[]> {
		const { steps, errors } = await this.findFeatureStepsTolerant(feature);
		const [firstError] = errors;
		if (firstError) {
			throw Error(`findFeatureStep for "${firstError.featureLine.line}": ${firstError.error.message} in ${feature.path}\nUse --show-steppers for more details`);
		}
		return steps.filter((s) => s.action.stepperName !== "Directive");
	}

	public findFeatureStepsTolerant(feature: TExpandedFeature): Promise<{ steps: TFeatureStep[]; errors: { featureLine: TExpandedLine; error: Error }[] }> {
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
		for (const [i, featureLine] of feature.expanded.entries()) {
			const line = featureLine.line.trim();
			if (line.startsWith("```")) {
				inCodeBlock = !inCodeBlock;
				continue;
			}
			if (inCodeBlock) {
				continue;
			}

			const actionable = getActionable(featureLine.line);
			const actualSourcePath = featureLine.feature?.base && featureLine.feature?.path ? featureLine.feature.base + featureLine.feature.path : undefined;

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
					const statements = Object.values(stepAction.stepValuesMap).filter((v: TStepValue & { label?: string }) => v.domain === DOMAIN_STATEMENT && v.term);
					for (const ph of statements) {
						const rawVal = ph.term as string;
						try {
							this.callResolveFeatureLine(rawVal, feature.path);
							this.findSingleStepAction(rawVal);
						} catch (e) {
							throw Error(`statement '${rawVal}' invalid: ${errorDetail(e)}`);
						}
					}
				}

				const featureStep = this.getFeatureStep(featureLine, seq, stepAction);
				steps.push(featureStep);
			} catch (e) {
				errors.push({ featureLine, error: asError(e) });
			}
		}
		return { steps, errors };
	}
	/**
	 * The one step a line resolves to. How a line is written decides whether it is prose: a sentence is prose, but for a
	 * step whose pattern starts with a capital, such as a heading whose title ends with punctuation. A line that starts
	 * with a character other than a letter is prose where the steps' patterns don't match it. A pattern reads a line after
	 * `dePolite` removes its leading articles, so without this rule a sentence such as "A type is a view." would match
	 * `type {text}`.
	 */
	findSingleStepAction(line: string): TStepAction {
		const sentence = SENTENCE.test(line);
		const found = this.findActionableSteps(line).filter((a) => !sentence || writtenCapitalized(a.step));
		if (found.length === 0 && (sentence || STARTS_WITH_NON_LETTER.test(line))) return this.selectStep(line, this.proseSteps());
		return this.withStatementsAsWritten(this.selectStep(line, found));
	}

	/**
	 * A statement a line passes in quotes is matched without them. A statement that starts and ends with a quoted term,
	 * such as `"Le Artiste" has "signed"`, is matched the same way and loses the quotes of its own terms. Where the text
	 * without the quotes doesn't match a step and the text with them does, the statement keeps them.
	 */
	private withStatementsAsWritten(action: TStepAction): TStepAction {
		for (const value of Object.values(action.stepValuesMap ?? {})) {
			if (value.domain !== DOMAIN_STATEMENT || value.origin !== Origin.quoted || !value.term) continue;
			const written = `"${value.term}"`;
			if (this.findActionableSteps(value.term).length === 0 && this.findActionableSteps(written).length > 0) value.term = written;
		}
		return action;
	}

	/** The one step of those a line matched: a unique step, then any but a fallback, then any a match doesn't preclude. */
	private selectStep(line: string, candidates: TStepAction[]): TStepAction {
		let stepActions = candidates;
		if (stepActions.length > 1) {
			const unique = stepActions.filter((a) => a.step.unique);
			if (unique.length === 1) {
				return itemAt(unique, 0);
			}
			// Filter out fallback steps if there are non-fallback alternatives
			const nonFallback = stepActions.filter((a) => !a.step.fallback);
			if (nonFallback.length > 0) {
				stepActions = nonFallback;
			}
			// If still multiple matches, use precludes
			if (stepActions.length > 1) {
				const precludes = stepActions.flatMap((a) => a.step.precludes ?? []);
				stepActions = stepActions.filter((a) => !precludes.includes(`${a.stepperName}.${a.actionName}`));
			}
			if (stepActions.length !== 1) {
				throw Error(`not one step found for "${line}": ${JSON.stringify(stepActions.map((a) => a.actionName))}`);
			}
		} else if (stepActions.length < 1) {
			throw Error(`"${line}" doesn't match a step`);
		}
		return itemAt(stepActions, 0);
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

	/** Each step a caller is offered, with the stepper that declares it. */
	private offeredSteps(): TStepAction[] {
		return this.steppers.flatMap((stepper) => {
			const stepperName = constructorName(stepper);
			return Object.entries(stepper.steps)
				.filter(([actionName, step]) => !this.offers || this.offers(stepperName, actionName, step))
				.map(([actionName, step]) => ({ actionName, stepperName, step }));
		});
	}

	private findActionableSteps(actionable: string): TStepAction[] {
		return this.offeredSteps().flatMap(({ step, actionName, stepperName }) => this.stepApplies(step, actionable, actionName, stepperName) ?? []);
	}

	/** The steps a prose line resolves to, which declare `prose` in place of a pattern. */
	private proseSteps(): TStepAction[] {
		return this.offeredSteps().filter(({ step }) => step.prose);
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

function getActionableStatement(steppers: AStepper[], statement: string, path: string, seqPath: number[], lineNumber?: number) {
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

export function findFeatureStepsFromStatement(statement: string, steppers: AStepper[], world: TWorld, base: string | undefined, seqStart: number[], inc = 1): TFeatureStep[] {
	const featureSteps: TFeatureStep[] = [];
	if (!world.runtime.backgrounds) {
		throw new Error("runtime.backgrounds is undefined; cannot expand inline Backgrounds");
	}
	// expandLine needs a feature context: a Backgrounds: directive ignores it and uses the actual
	// background files, while a regular statement uses this feature's path. `base` is the full path,
	// so it goes in feature.base with feature.path left empty.
	// A statement a step called over RPC or MCP states doesn't have a source file, so its lines don't have a base path.
	const contextFeature: TFeature = { path: "", base: base ?? "", name: "statement-context", content: statement };
	const expanded = expandLine(statement, undefined, world.runtime.backgrounds, contextFeature);
	// Increment the last segment of seqStart by inc for each expanded step
	const prefix = seqStart.slice(0, -1);
	let latest = itemAt(seqStart, seqStart.length - 1);
	for (const x of expanded) {
		const seqPath = [...prefix, latest];
		const fullPath = x.feature.base + x.feature.path;
		try {
			const { featureStep } = getActionableStatement(steppers, x.line, fullPath, seqPath, x.lineNumber);
			latest += inc;
			featureSteps.push(featureStep);
		} catch (e) {
			const why = errorDetail(e);
			featureSteps.push({
				source: {
					path: fullPath,
					lineNumber: x.lineNumber,
				},
				in: x.line,
				seqPath,
				// The line didn't resolve to a step, so it stands as a step a registry doesn't hold, and its miss states why.
				action: {
					actionName: "error",
					stepperName: "Resolver",
					step: {
						description: why,
						action: async () => actionNotOK(why),
					},
				},
			});
		}
	}
	return featureSteps;
}
