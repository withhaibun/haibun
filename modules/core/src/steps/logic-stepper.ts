import { AStepper, TStepperSteps, IHasCycles, TFeatureStep, IObservationSource, IStepperCycles, hasCycles } from "../lib/steps/domains/stepper.js";
import type { TWorld } from "../lib/actuality/domains/world.js";
import { OK, TActionResult, Origin } from "../lib/domains/protocol.js";
import { actionNotOK, actionOKWithProducts } from "../lib/domains/util.js";
import { itemAt } from "../lib/domains/item-at.js";
import { z } from "zod";
import { FlowRunner, inheritedMode } from "../lib/steps/pipelines/flow-runner.js";
import { DOMAIN_NUMBER, DOMAIN_STATEMENT, DOMAIN_STRING } from "../lib/domains/domains.js";
import { readEvery, equalTo } from "../lib/records/pipelines/record-reads.js";
import { SEQ_PATH_LABEL } from "../lib/domains/resources.js";
import { SEQ_PATH_FIELD, calledParts, executionOf } from "../lib/actuality/domains/seq-path.js";

/** The outcome of a statement run as `maybe`. A failed outcome doesn't fail the step. */
const MaybeOutcomeSchema = z.object({ outcome: z.looseObject({ ok: z.boolean() }) });
const DOMAIN_MAYBE_OUTCOME = "maybe-outcome";

/** Counts the step records of the feature's execution by the step each called, as `Stepper.action`. */
async function stepCounts(world: TWorld): Promise<Map<string, number>> {
	const steps = await readEvery(world.shared.getStore(), { label: SEQ_PATH_LABEL, filters: equalTo({ [SEQ_PATH_FIELD.execution]: executionOf(world.tag) }) });
	const called = steps.map((step) => step[SEQ_PATH_FIELD.called]).filter((one): one is string => typeof one === "string");
	return new Map([...Map.groupBy(called, (one) => one)].map(([one, held]) => [one, held.length]));
}

/** Returns each counted item and its count as a source's items and metrics. */
const observedCounts = (counts: Map<string, number>) => ({ items: [...counts.keys()], metrics: Object.fromEntries([...counts].map(([item, count]) => [item, { count }])) });

// The built-in observation sources count the step records of the feature's execution: by step, and by stepper.
const builtInSources: IObservationSource[] = [
	{ name: "step usage", observe: async (world: TWorld) => observedCounts(await stepCounts(world)) },
	{
		name: "stepper usage",
		observe: async (world: TWorld) => {
			const calls = [...(await stepCounts(world))].map(([called, count]) => ({ stepperName: calledParts(called).stepperName, count }));
			return observedCounts(new Map([...Map.groupBy(calls, ({ stepperName }) => stepperName)].map(([name, held]) => [name, held.reduce((sum, { count }) => sum + count, 0)])));
		},
	},
];

export default class LogicStepper extends AStepper implements IHasCycles {
	description = "Control flow with conditionals, loops, negation, and quantifiers";

	steppers: AStepper[] = [];
	private held?: FlowRunner;
	private get runner(): FlowRunner {
		return this.madeWithWorld(this.held, "flow runner");
	}
	private sources: IObservationSource[] = [...builtInSources];

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.held = new FlowRunner(world, steppers);

		// Collects observation sources from other steppers.
		for (const stepper of steppers) {
			if (hasCycles(stepper)) {
				const concerns = stepper.cycles.getConcerns?.();
				if (concerns?.sources) {
					this.sources.push(...concerns.sources);
				}
			}
		}
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			sources: builtInSources,
			domains: [{ selectors: [DOMAIN_MAYBE_OUTCOME], schema: MaybeOutcomeSchema, description: "The outcome of a statement run as maybe" }],
		}),
	};

	private getSource(name: string): IObservationSource | undefined {
		return this.sources.find((s) => s.name.toLowerCase() === name.toLowerCase());
	}

	/** Binds a quantifier's variable to one item, and each of the item's metrics under the variable's name
	 *  (`request/status`), so a metric term doesn't carry an item's dots or slashes. */
	private async bindItem(what: string, item: string, metrics: Record<string, unknown> | undefined, featureStep: TFeatureStep): Promise<void> {
		const at = { in: featureStep.in, seq: featureStep.seqPath };
		await this.getWorld().shared.set({ term: what, value: String(item), domain: DOMAIN_STRING, origin: Origin.var }, { ...at, when: "quantifier" });
		for (const [metric, value] of metrics === undefined ? [] : Object.entries(metrics)) {
			const domain = typeof value === "number" ? DOMAIN_NUMBER : DOMAIN_STRING;
			await this.getWorld().shared.set({ term: `${what}/${metric}`, value: String(value), domain, origin: Origin.var }, { ...at, when: "observation" });
		}
	}

	private stripQuotes(text: string): string {
		if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("`") && text.endsWith("`"))) {
			return text.slice(1, -1);
		}
		return text;
	}

	/**
	 * Returns the values and metrics of a quantifier's iteration, from a domain or an observation source.
	 * Syntax: "in {domain}" or "observed in {source}"
	 */
	private async getIterationValues(phrase: string): Promise<{ values: string[]; metrics?: Record<string, Record<string, unknown>>; error?: string }> {
		// Matches the "observed in {source}" pattern.
		const observedMatch = phrase.match(/^observed in (.+)$/i);
		if (observedMatch) {
			const sourceName = itemAt(observedMatch, 1).trim();
			const source = this.getSource(sourceName);
			if (!source) return { values: [], error: `Unknown observation source: "${sourceName}"` };
			const { items, metrics } = await source.observe(this.getWorld());
			return { values: items, metrics };
		}

		// Otherwise the phrase is a domain name.
		const domainName = this.stripQuotes(phrase);
		const result = await this.getWorld().shared.getDomainValues(domainName);
		return { values: result.values === undefined ? [] : (result.values as string[]), error: result.error };
	}

	steps = {
		// -------------------------------------------------------------------------
		// CONTROL FLOW
		// -------------------------------------------------------------------------

		// RECURRENCE: While(Condition) { Action }
		whenever: {
			gwta: "whenever {condition:statement}, {action:statement}",
			description: "Executes the statements repeatedly while the condition holds true.",
			action: async ({ condition, action }: { condition: TFeatureStep[]; action: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
				let loopCount = 0;
				const MAX_LOOPS = 1000;
				const mode = inheritedMode(featureStep);
				const usage = featureStep.intent?.usage;

				while (true) {
					if (loopCount++ > MAX_LOOPS) return actionNotOK("whenever: the condition still held after the maximum number of loops. Make the action change the condition.");

					const check = await this.runner.runSteps(condition, { intent: { mode: "speculative", usage }, parentStep: featureStep });

					if (!check.ok) break;

					const result = await this.runner.runSteps(action, { intent: { mode, usage }, parentStep: featureStep });

					if (!result.ok) {
						return actionNotOK(`whenever: action failed: ${result.errorMessage}`);
					}
					await this.getWorld().clock.wait(0);
				}
				return OK;
			},
		},

		// IMPLICATION: If P then Q
		where: {
			gwta: "where {condition:statement}, {action:statement}",
			description: "Executes the statements only if the condition is met.",
			action: async ({ condition, action }: { condition: TFeatureStep[]; action: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
				const usage = featureStep.intent?.usage;
				const check = await this.runner.runSteps(condition, { intent: { mode: "speculative", usage }, parentStep: featureStep });

				// Vacuously true if condition is false
				if (!check.ok) return OK;

				const mode = inheritedMode(featureStep);
				const result = await this.runner.runSteps(action, { intent: { mode, usage }, parentStep: featureStep });

				return result.ok ? OK : actionNotOK(`Constraint failed: Condition was true, but Action failed: ${result.errorMessage}`);
			},
		},

		// DISJUNCTION: A or B or C
		anyOf: {
			match: /^any of (.*)/,
			description: "Succeeds if at least one of the listed conditions is true.",
			action: async (_: unknown, featureStep: TFeatureStep): Promise<TActionResult> => {
				let statements = featureStep.in.replace(/^any of /i, "").trim();
				statements = this.stripQuotes(statements);
				const statementList = statements.split(",").map((s) => s.trim());
				for (const statement of statementList) {
					const res = await this.runner.runStatements([statement], { intent: { mode: "speculative" }, parentStep: featureStep });
					if (res.ok) return OK;
					this.getWorld().eventLogger.debug(`any of: statement "${statement}" failed: ${res.errorMessage}`);
				}
				return actionNotOK("every condition in the list failed");
			},
		},

		// NEGATION: Not P
		not: {
			gwta: `not {statements:${DOMAIN_STATEMENT}}`,
			description: "Succeeds if the statement is false (negation).",
			action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
				const res = await this.runner.runSteps(statements, { intent: { mode: "speculative" }, parentStep: featureStep });

				if (!res.ok) {
					return OK;
				} else {
					return actionNotOK("not statement was true (failed negation)");
				}
			},
		},

		// MAYBE: It's possible that P is true
		maybe: {
			gwta: `maybe {statements:${DOMAIN_STATEMENT}}`,
			description: "Executes the statement but suppresses failure if it fails.",
			productsDomain: DOMAIN_MAYBE_OUTCOME,
			action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const res = await this.runner.runSteps(statements, { intent: { mode: "speculative" }, parentStep: featureStep });

				return actionOKWithProducts({ outcome: res });
			},
		},

		// -------------------------------------------------------------------------
		// QUANTIFIERS
		// Supports both: "in {domain}" and "observed in {source}"
		// -------------------------------------------------------------------------

		// EXISTENTIAL: Exists x in D such that P(x)
		// some x in Domain is ...
		// some x observed in step usage is ...
		some: {
			match: /^some (.*?) (in|observed in) (.*?) is (.*)/,
			description: "Succeeds if at least one item in the collection satisfies the condition.",
			action: async (_: unknown, featureStep: TFeatureStep): Promise<TActionResult> => {
				const match = featureStep.in.match(/^some (.*?) (in|observed in) (.*?) is (.*)/);
				if (!match) return actionNotOK(`some: "${featureStep.in}" isn't written as some {name} in {domain} is {statement}; write it in that form`);
				const [what, connector, sourceOrDomain, quotedStatement] = [itemAt(match, 1), itemAt(match, 2), itemAt(match, 3), itemAt(match, 4)] as const;
				// stripQuotes removes the quotes around a quoted inner statement. A quoted statement doesn't match a gwta. It
				// resolves as prose, and prose always passes, so the quantifier wouldn't check the statement.
				const statementStr = this.stripQuotes(quotedStatement.trim());

				const phrase = connector === "observed in" ? `observed in ${sourceOrDomain}` : sourceOrDomain;
				const { values, metrics, error } = await this.getIterationValues(phrase);
				if (error) return actionNotOK(error);

				if (values.length === 0) return actionNotOK(`"${sourceOrDomain}" doesn't have members to check`);

				const mode = "speculative";
				let found = false;

				for (const val of values) {
					await this.bindItem(what, val, metrics?.[val], featureStep);

					const res = await this.runner.runStatements([statementStr], { intent: { mode }, parentStep: featureStep });
					if (res.ok) {
						found = true;
						break;
					}
				}
				return found ? OK : actionNotOK(`some: every ${what} in ${sourceOrDomain} failed the condition`);
			},
		},

		// UNIVERSAL: For All x in D, P(x)
		// every x in Domain is ...
		// every x observed in step usage is ...
		every: {
			match: /^every (.*?) (in|observed in) (.*?) is (.*)/,
			description: "Succeeds only if all items in the collection satisfy the condition.",
			action: async (_: unknown, featureStep: TFeatureStep): Promise<TActionResult> => {
				const match = featureStep.in.match(/^every (.*?) (in|observed in) (.*?) is (.*)/);
				if (!match) return actionNotOK(`every: "${featureStep.in}" isn't written as every {name} in {domain} is {statement}; write it in that form`);
				const [what, connector, sourceOrDomain, quotedStatement] = [itemAt(match, 1), itemAt(match, 2), itemAt(match, 3), itemAt(match, 4)] as const;
				const statementStr = this.stripQuotes(quotedStatement.trim());

				const phrase = connector === "observed in" ? `observed in ${sourceOrDomain}` : sourceOrDomain;
				const { values, metrics, error } = await this.getIterationValues(phrase);
				if (error) return actionNotOK(error);

				if (values.length === 0) return OK;

				const mode = inheritedMode(featureStep);

				for (const val of values) {
					await this.bindItem(what, val, metrics?.[val], featureStep);

					const res = await this.runner.runStatements([statementStr], { intent: { mode }, parentStep: featureStep });
					if (!res.ok) {
						return actionNotOK(`Universal check failed for value "${val}": ${res.errorMessage}`);
					}
				}
				return OK;
			},
		},
	} as const satisfies TStepperSteps;
}
