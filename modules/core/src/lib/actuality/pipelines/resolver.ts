import type { TExpandedFeature, TExpandedLine, TFeatures, TFeature } from "../domains/execution.js";
import type { TWorld } from "../domains/world.js";
import { TStepValue, SCENARIO_START, PENDING_SCENARIO, HEADINGS, Origin } from "../../domains/protocol.js";
import { AStepper, TStepAction, TResolvedFeature, TStepperStep, TFeatureStep, hasCycles } from "../../steps/domains/stepper.js";
import type { TDomainDefinition } from "../../domains/resources.js";
import { matchGwtaToAction } from "../../steps/derivations/named-vars.js";
import { getActionable, dePolite, actionNotOK, asError, errorDetail } from "../../domains/util.js";
import { itemAt } from "../../domains/item-at.js";
import { DOMAIN_STATEMENT } from "../../domains/domains.js";
import { heldPerEntries } from "../../steps/derivations/held-per-entries.js";
import { declaredSteps } from "../../steps/derivations/predicate-registry.js";
import { expandLine } from "../../domains/features.js";

/** Matches a line written as a sentence. A sentence starts with a capital letter and ends with `.`, `!`, `?`, `:` or `;`. */
const SENTENCE = /^[A-Z].*[.!?:;]$/;
/** Matches a line that starts with a character other than a letter. A heading, a list item, a table row and a link start this way. */
const STARTS_WITH_NON_LETTER = /^[^a-zA-Z]/;
/** Returns whether a step's pattern starts with a capital letter. The pattern of the `Scenario:` heading step starts with one. */
const writtenCapitalized = (step: TStepperStep): boolean => {
	const pattern = step.gwta ?? step.exact;
	return pattern !== undefined && /^[A-Z]/.test(pattern);
};

/** The base of a statement a caller sent without a source file, such as over RPC or MCP: an empty path. */
const WITHOUT_SOURCE = "";

export class Resolver {
	public backgroundWarnings: { path: string; line: string; error: string }[] = [];

	/**
	 * @param offers returns whether a line may resolve to a step. A caller that holds only some steps passes it. A line may
	 * resolve to every step when offers is undefined.
	 */
	constructor(
		private steppers: AStepper[],
		private backgrounds: TFeatures,
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
			// Steppers select what applies in each feature before it resolves.
			this.startFeatureResolution(feature.path);
			const featureSteps = await this.findFeatureSteps(feature);
			const { expanded: _expanded, ...resolved } = feature;
			steps.push({ ...resolved, featureSteps });
		}
		return steps;
	}

	/** Calls each stepper's startFeatureResolution before a feature resolves, so a stepper selects what applies in that
	 *  feature. A waypoint a feature states applies in that feature alone. */
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
		// A pending scenario's lines state steps the steppers don't provide yet, so they aren't resolved, up to the next heading.
		let pending = false;
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

			if (pending) {
				const heading = this.headingOf(actionable);
				if (heading === undefined) continue;
				pending = heading === PENDING_SCENARIO;
			}
			seq++;

			try {
				const stepAction = this.findSingleStepAction(actionable);

				if (stepAction.actionName === SCENARIO_START || stepAction.actionName === PENDING_SCENARIO) seq = 0;
				if (stepAction.actionName === PENDING_SCENARIO) pending = true;

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
	/** The heading a line states, a feature's, a scenario's or a pending scenario's, or undefined where it isn't a heading. */
	private headingOf(line: string): string | undefined {
		return this.findActionableSteps(line).find(({ actionName }) => HEADINGS.includes(actionName))?.actionName;
	}

	/**
	 * Returns the one step that a line matches. The form of a line determines whether it is prose. A sentence matches only a
	 * step whose pattern starts with a capital letter. The sentence `Scenario: Sign in.` matches the `Scenario:` heading
	 * step. A sentence that doesn't match such a step resolves to a prose step. A line that starts with a character other
	 * than a letter resolves to a prose step when it doesn't match a step. A pattern matches a line after `dePolite`
	 * removes the line's leading words such as `a`, `the` and `given`. The sentence "A type is a view." would match
	 * `type {text}` if a sentence could match a pattern that starts with a lowercase letter.
	 */
	findSingleStepAction(line: string): TStepAction {
		return this.refusingWritten(line, this.parsedStepAction(line));
	}

	/** Returns the one step a line parses to, as findSingleStepAction does, without holding the terms it writes to their domains. */
	parsedStepAction(line: string): TStepAction {
		const sentence = SENTENCE.test(line);
		const found = this.findActionableSteps(line).filter((a) => !sentence || writtenCapitalized(a.step));
		if (found.length === 0 && (sentence || STARTS_WITH_NON_LETTER.test(line))) return this.selectStep(line, this.proseSteps());
		return this.withStatementsAsWritten(this.selectStep(line, found));
	}

	/** Returns the action where each term its line writes is a value of its placeholder's domain. Throws the refusal of the
	 *  first term a domain refuses, so the line doesn't resolve. */
	private refusingWritten(line: string, action: TStepAction): TStepAction {
		const refusing = this.refusingDomains(this.steppers);
		for (const [name, value] of Object.entries(action.stepValuesMap === undefined ? {} : action.stepValuesMap)) {
			const refusal = refusing.get(value.domain)?.(value.term, this.steppers);
			if (refusal !== undefined) throw Error(`"${line}" doesn't resolve: {${name}} ${refusal}`);
		}
		return action;
	}

	/** The domains the steppers declare that refuse a written term, by name, derived again only where a stepper's steps change. */
	private readonly refusingDomains = heldPerEntries(
		(steppers: readonly AStepper[]) => steppers,
		(steppers: readonly AStepper[]): Map<string, NonNullable<TDomainDefinition["refuses"]>> =>
			new Map(
				steppers.flatMap((stepper) => {
					const declared = hasCycles(stepper) ? stepper.cycles.getConcerns?.()?.domains : undefined;
					return (declared === undefined ? [] : declared).flatMap(({ selectors, refuses }) =>
						refuses === undefined ? [] : selectors.map((selector) => [selector, refuses] as const),
					);
				}),
			),
	);

	/**
	 * Restores the outer quotes of a statement where its quoted text matches a step. A statement that a line passes in
	 * quotes is matched without the quotes. A statement that starts and ends with a quoted term loses the quotes of its own
	 * terms in the same way. `"Le Artiste" is past negotiating on "signed"` is such a statement. The statement keeps its
	 * outer quotes when its text without them doesn't match a step and its text with them does.
	 */
	private withStatementsAsWritten(action: TStepAction): TStepAction {
		if (action.stepValuesMap === undefined) return action;
		for (const value of Object.values(action.stepValuesMap)) {
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
				const precludes = stepActions.flatMap((a) => (a.step.precludes === undefined ? [] : a.step.precludes));
				stepActions = stepActions.filter((a) => !precludes.includes(`${a.stepperName}.${a.actionName}`));
			}
			if (stepActions.length !== 1) {
				throw Error(
					`"${line}" parses to more than one step: ${stepActions.map((a) => `${a.stepperName}.${a.actionName}`).join(", ")}. Quote each term, escaping a quote within it as \\", or state the line as steps of their own`,
				);
			}
		} else if (stepActions.length < 1) {
			throw Error(`"${line}" doesn't match a step`);
		}
		return itemAt(stepActions, 0);
	}

	/** The step of a feature's line, recorded at that line, whether its step is its own or a waypoint's rule it applies. */
	getFeatureStep(featureLine: TExpandedLine, seq: number, action: TStepAction): TFeatureStep {
		return { source: { path: featureLine.feature.base + featureLine.feature.path, lineNumber: featureLine.lineNumber }, in: featureLine.line, seqPath: [seq], action };
	}

	/** Each step that `offers` allows and the stepper that declares it, derived again only where a stepper's steps change. */
	private readonly offered = heldPerEntries(
		(steppers: readonly AStepper[]) => steppers.flatMap((stepper) => [stepper, ...Object.entries(stepper.steps).flat()]),
		(steppers: readonly AStepper[]): TStepAction[] =>
			declaredSteps(steppers).filter(({ stepperName, actionName, step }) => !this.offers || this.offers(stepperName, actionName, step)),
	);

	private offeredSteps(): TStepAction[] {
		return this.offered(this.steppers);
	}

	private matchesAStep(actionable: string): boolean {
		const curt = dePolite(actionable);
		return this.offeredSteps().some(({ step, actionName, stepperName }) => this.stepApplies(step, curt, actionName, stepperName).length > 0);
	}

	private findActionableSteps(actionable: string): TStepAction[] {
		const curt = dePolite(actionable);
		return this.offeredSteps().flatMap(({ step, actionName, stepperName }) => this.stepApplies(step, curt, actionName, stepperName));
	}

	/** Returns the steps that declare `prose` in place of a pattern. A prose line resolves to one of them. */
	private proseSteps(): TStepAction[] {
		return this.offeredSteps().filter(({ step }) => step.prose);
	}

	/** The step actions a line resolves to under a step: one where its pattern or its exact text matches, and one for each of
	 *  its rules whose head the line unifies with, which holds that rule. `curt` is the line after dePolite. */
	private stepApplies(step: TStepperStep, curt: string, actionName: string, stepperName: string): TStepAction[] {
		if (step.rules !== undefined && step.reading !== undefined)
			return step.rules().flatMap((rule) => patternApplies(rule.pattern, curt, actionName, stepperName, { ...step, rule }));
		if (step.gwta) return patternApplies(step.gwta, curt, actionName, stepperName, step);
		return step.exact === curt ? [{ actionName, stepperName, step }] : [];
	}
}

/** The step action a line resolves to under a pattern, where the pattern matches it. A line that starts with an uppercase
 *  letter after dePolite matches only a pattern that starts with an uppercase letter or a placeholder. Prose starts with an
 *  uppercase letter and a step starts with a lowercase letter, so this check separates them. */
function patternApplies(pattern: string, curt: string, actionName: string, stepperName: string, step: TStepperStep): TStepAction[] {
	if (/^[A-Z]/.test(curt) && !/^[A-Z]/.test(pattern) && !pattern.startsWith("{")) return [];
	const applied = matchGwtaToAction(pattern, curt, actionName, stepperName, step);
	return applied === undefined ? [] : [applied];
}

export function findFeatureStepsFromStatement(statement: string, steppers: AStepper[], world: TWorld, base: string | undefined, seqStart: number[]): TFeatureStep[] {
	const featureSteps: TFeatureStep[] = [];
	if (!world.runtime.backgrounds) {
		throw new Error("runtime.backgrounds is undefined, so an inline Backgrounds: line can't expand. Set world.runtime.backgrounds before resolving a statement.");
	}
	// expandLine requires a feature context. A Backgrounds: line ignores the context and reads the named backgrounds from
	// world.runtime.backgrounds. A regular statement takes its source path from the context. The `base` argument holds the
	// full path. contextFeature.base holds that path, and contextFeature.path is empty. A statement passed to a step called
	// over RPC or MCP doesn't have a source file, so its base path is empty.
	const contextFeature: TFeature = { path: "", base: base === undefined ? WITHOUT_SOURCE : base, name: "statement-context", content: statement };
	const expanded = expandLine(statement, undefined, world.runtime.backgrounds, contextFeature);
	// Increments the last segment of seqStart for each expanded line that resolves to a step.
	const prefix = seqStart.slice(0, -1);
	let latest = itemAt(seqStart, seqStart.length - 1);
	for (const x of expanded) {
		const seqPath = [...prefix, latest];
		const fullPath = x.feature.base + x.feature.path;
		try {
			const action = new Resolver(steppers, []).findSingleStepAction(x.line);
			latest += 1;
			featureSteps.push({ source: { path: fullPath, lineNumber: x.lineNumber }, in: x.line, seqPath, action });
		} catch (e) {
			const why = errorDetail(e);
			featureSteps.push({
				source: { path: fullPath, lineNumber: x.lineNumber },
				in: x.line,
				seqPath,
				// The line didn't resolve to a step, so it becomes a Resolver error step. The registry doesn't hold that step. Its
				// action returns the resolution error.
				action: { actionName: "error", stepperName: "Resolver", step: { description: why, action: async () => actionNotOK(`"${x.line}" doesn't resolve to a step: ${why}`) } },
			});
		}
	}
	return featureSteps;
}
