import type { TExpandedFeature, TExpandedLine, TFeatures, TFeature } from "../lib/execution.js";
import type { TWorld } from "../lib/world.js";
import { TStepValue, FEATURE_START, SCENARIO_START, Origin } from "../schema/protocol.js";
import { AStepper, TStepAction, TResolvedFeature, TStepperStep, TFeatureStep } from "../lib/steps/domains/stepper.js";
import { matchGwtaToAction, getMatch } from "../lib/steps/derivations/named-vars.js";
import { getActionable, dePolite, constructorName, actionNotOK, asError, errorDetail } from "../lib/util/index.js";
import { itemAt } from "../lib/util/item-at.js";
import { DOMAIN_STATEMENT } from "../lib/domains.js";
import { heldPerEntries } from "../lib/steps/derivations/held-per-entries.js";
import { expandLine } from "../lib/features.js";

/** Matches a line written as a sentence. A sentence starts with a capital letter and ends with `.`, `!`, `?`, `:` or `;`. */
const SENTENCE = /^[A-Z].*[.!?:;]$/;
/** Matches a line that starts with a character other than a letter. A heading, a list item, a table row and a link start this way. */
const STARTS_WITH_NON_LETTER = /^[^a-zA-Z]/;
/** Returns whether a step's pattern starts with a capital letter. The pattern of the `Scenario:` heading step starts with one. */
const writtenCapitalized = (step: TStepperStep) => /^[A-Z]/.test(step.gwta ?? step.exact ?? "");

export class Resolver {
	public backgroundWarnings: { path: string; line: string; error: string }[] = [];

	/**
	 * @param offers returns whether a line may resolve to a step. A caller that holds only some steps passes it. A line may
	 * resolve to every step when offers is undefined.
	 */
	constructor(
		private steppers: AStepper[],
		private backgrounds: TFeatures = [],
		private offers?: (stepperName: string, actionName: string, step: TStepperStep) => boolean,
	) {
		// Resolves each background line so steppers register their metadata. A waypoint statement is one kind of metadata.
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
						// Collects a warning instead of throwing, so the LSP logs a background line that doesn't resolve and continues.
						this.backgroundWarnings.push({ path: background.path, line, error: errorDetail(e) });
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
			// Steppers clear feature-scoped steps before each feature resolves.
			this.startFeatureResolution(feature.path);
			const featureSteps = await this.findFeatureSteps(feature);
			const { expanded: _expanded, ...resolved } = feature;
			steps.push({ ...resolved, featureSteps });
		}
		return steps;
	}

	/** Calls each stepper's startFeatureResolution before a feature resolves, so a stepper clears its feature-scoped steps. A
	 *  feature-scoped step must not resolve in another feature. */
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

	public findFeatureStepsTolerantSync(feature: TExpandedFeature): { steps: TFeatureStep[]; errors: { featureLine: TExpandedLine; error: Error }[] } {
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
					source: { path: actualSourcePath || feature.path, lineNumber: featureLine.lineNumber },
					in: featureLine.line,
					seqPath: [seq],
					action: { stepperName: "Directive", actionName: "directive", step: { exact: actionable, action: async () => ({ ok: true }) } },
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
							throw Error(`statement '${rawVal}' doesn't resolve: ${errorDetail(e)}`);
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
	 * Returns the one step a line resolves to. The form of a line determines whether it is prose. A sentence matches only a
	 * step whose pattern starts with a capital letter. The sentence `Scenario: Sign in.` matches the `Scenario:` heading
	 * step. A sentence that doesn't match such a step resolves to a prose step. A line that starts with a character other
	 * than a letter resolves to a prose step when it doesn't match a step. A pattern matches a line after `dePolite`
	 * removes the line's leading words such as `a`, `the` and `given`. The sentence "A type is a view." would match
	 * `type {text}` if a sentence could match a pattern that starts with a lowercase letter.
	 */
	findSingleStepAction(line: string): TStepAction {
		const sentence = SENTENCE.test(line);
		const found = this.findActionableSteps(line).filter((a) => !sentence || writtenCapitalized(a.step));
		if (found.length === 0 && (sentence || STARTS_WITH_NON_LETTER.test(line))) return this.selectStep(line, this.proseSteps());
		return this.withStatementsAsWritten(this.selectStep(line, found));
	}

	/**
	 * Restores the outer quotes of a statement where its quoted text matches a step. A statement that a line passes in
	 * quotes is matched without the quotes. A statement that starts and ends with a quoted term loses the quotes of its own
	 * terms in the same way. `"Le Artiste" has "signed"` is such a statement. The statement keeps its outer quotes when its
	 * text without them doesn't match a step and its text with them does.
	 */
	private withStatementsAsWritten(action: TStepAction): TStepAction {
		for (const value of Object.values(action.stepValuesMap ?? {})) {
			// Only a statement that contains a quote can lose the quotes of its own terms, so other statements aren't matched again.
			if (value.domain !== DOMAIN_STATEMENT || value.origin !== Origin.quoted || !value.term?.includes('"')) continue;
			const written = `"${value.term}"`;
			if (!this.matchesAStep(value.term) && this.matchesAStep(written)) value.term = written;
		}
		return action;
	}

	/** Selects one step from the steps a line matched. It returns the unique step when exactly one candidate is unique.
	 *  Otherwise it removes fallback steps when a non-fallback step remains. It then removes each step that another
	 *  candidate precludes. It throws unless exactly one step remains. */
	private selectStep(line: string, candidates: TStepAction[]): TStepAction {
		let stepActions = candidates;
		if (stepActions.length > 1) {
			const unique = stepActions.filter((a) => a.step.unique);
			if (unique.length === 1) {
				return itemAt(unique, 0);
			}
			// Removes fallback steps when a non-fallback step remains.
			const nonFallback = stepActions.filter((a) => !a.step.fallback);
			if (nonFallback.length > 0) {
				stepActions = nonFallback;
			}
			// Removes each step that another candidate precludes when several candidates remain.
			if (stepActions.length > 1) {
				const precludes = stepActions.flatMap((a) => a.step.precludes ?? []);
				stepActions = stepActions.filter((a) => !precludes.includes(`${a.stepperName}.${a.actionName}`));
			}
			if (stepActions.length !== 1) {
				throw Error(`"${line}" doesn't resolve to one step. Candidate steps: ${JSON.stringify(stepActions.map((a) => a.actionName))}`);
			}
		} else if (stepActions.length < 1) {
			throw Error(`"${line}" doesn't match a step`);
		}
		return itemAt(stepActions, 0);
	}

	getFeatureStep(featureLine: TExpandedLine, seq: number, action: TStepAction): TFeatureStep {
		// A virtual step uses its own source location when it has one. A waypoint is a virtual step.
		const step = action.step;
		const lineNumber = step?.source?.lineNumber ?? featureLine.lineNumber;
		const path = step?.source?.path ?? featureLine.feature.base + featureLine.feature.path;
		return { source: { path, lineNumber }, in: featureLine.line, seqPath: [seq], action };
	}

	/** Each step that `offers` allows and the stepper that declares it, derived again only where a stepper's steps change,
	 *  as a waypoint adds a step and a feature's end clears its steps. */
	private readonly offered = heldPerEntries(
		(steppers: readonly AStepper[]) => steppers.flatMap((stepper) => [stepper, ...Object.entries(stepper.steps).flat()]),
		(steppers: readonly AStepper[]): TStepAction[] =>
			steppers.flatMap((stepper) => {
				const stepperName = constructorName(stepper);
				return Object.entries(stepper.steps)
					.filter(([actionName, step]) => !this.offers || this.offers(stepperName, actionName, step))
					.map(([actionName, step]) => ({ actionName, stepperName, step }));
			}),
	);

	private offeredSteps(): TStepAction[] {
		return this.offered(this.steppers);
	}

	private matchesAStep(actionable: string): boolean {
		const curt = dePolite(actionable);
		return this.offeredSteps().some(({ step, actionName, stepperName }) => this.stepApplies(step, actionable, curt, actionName, stepperName));
	}

	private findActionableSteps(actionable: string): TStepAction[] {
		const curt = dePolite(actionable);
		return this.offeredSteps().flatMap(({ step, actionName, stepperName }) => this.stepApplies(step, actionable, curt, actionName, stepperName) ?? []);
	}

	/** Returns the steps that declare `prose` in place of a pattern. A prose line resolves to one of them. */
	private proseSteps(): TStepAction[] {
		return this.offeredSteps().filter(({ step }) => step.prose);
	}

	/** The step action a line resolves to under a step, or undefined where it doesn't. `curt` is the line after dePolite. */
	private stepApplies(step: TStepperStep, actionable: string, curt: string, actionName: string, stepperName: string) {
		if (step.gwta) {
			// A line that starts with an uppercase letter after dePolite matches only a gwta that starts with an uppercase letter.
			// Prose starts with an uppercase letter and a step starts with a lowercase letter, so this check separates them.
			// A gwta that starts with a {variable} placeholder can match a line that starts with an uppercase letter.
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

	const featureStep: TFeatureStep = { source: { path: step?.source?.path || path, lineNumber: step?.source?.lineNumber ?? lineNumber }, in: statement, seqPath, action };

	return { featureStep, steppers };
}

export function findFeatureStepsFromStatement(statement: string, steppers: AStepper[], world: TWorld, base: string | undefined, seqStart: number[], inc = 1): TFeatureStep[] {
	const featureSteps: TFeatureStep[] = [];
	if (!world.runtime.backgrounds) {
		throw new Error("runtime.backgrounds is undefined, so an inline Backgrounds: line can't expand. Set world.runtime.backgrounds before resolving a statement.");
	}
	// expandLine requires a feature context. A Backgrounds: line ignores the context and reads the named backgrounds from
	// world.runtime.backgrounds. A regular statement takes its source path from the context. The `base` argument holds the
	// full path. contextFeature.base holds that path, and contextFeature.path is empty. A statement passed to a step called
	// over RPC or MCP doesn't have a source file, so its base path is empty.
	const contextFeature: TFeature = { path: "", base: base ?? "", name: "statement-context", content: statement };
	const expanded = expandLine(statement, undefined, world.runtime.backgrounds, contextFeature);
	// Increments the last segment of seqStart by inc for each expanded line that resolves to a step.
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
				source: { path: fullPath, lineNumber: x.lineNumber },
				in: x.line,
				seqPath,
				// The line didn't resolve to a step, so it becomes a Resolver error step. The registry doesn't hold that step. Its
				// action returns the resolution error.
				action: { actionName: "error", stepperName: "Resolver", step: { description: why, action: async () => actionNotOK(why) } },
			});
		}
	}
	return featureSteps;
}
