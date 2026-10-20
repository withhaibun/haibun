import { AStepper, READING, type IHasCycles, type IObservationSource, type IStepperCycles, type TFeatureStep, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";
import {
	DOMAIN_STATEMENT,
	DOMAIN_TEXT,
	DOMAIN_VARIABLE_NAME,
	DOMAIN_DOMAIN_NAME,
	DOMAIN_STEP_METHOD,
	DOMAIN_JSON,
	DOMAIN_DOMAIN_KEY,
	DOMAIN_JSON_OBJECT,
	DOMAIN_STEP_PATH,
} from "@haibun/core/lib/domains/domains.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { readEvery, equalTo } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { Access, SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD, calledParts, executionOf } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { callerHolds } from "@haibun/core/lib/domains/capability-context.js";
import {
	DOMAIN_AFFORDANCES,
	DOMAIN_CHAIN_LINT,
	DOMAIN_CHAIN_WALK,
	DOMAIN_GOAL_RESOLUTION,
	DOMAIN_WALK_ID,
	goalDomainDefinitions,
} from "@haibun/core/lib/domains/goal-resolution.js";
import { affordancesAt, chainLint, pursued, resolved, walkAdvanced, walkBegun, type TGoalScope } from "./pipelines/goals.js";
import { stepperContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { proverOf } from "./pipelines/prove.js";
import { callTerm, derivationUnder, formulaRefusal, lineTerm, refuseDeclarations, ruleOf } from "./pipelines/registry-reads.js";
import { logicEngine } from "./root.js";
import { DOMAIN_DERIVATION, DOMAIN_FORMULA, DOMAIN_LINE_TERM, DOMAIN_RULE, RESOLVE_STATEMENT, formulaDomainDefinition, logicDomainDefinitions } from "./domains/logic.js";
import { DOMAIN_ALTERNATIVES, DOMAIN_OBSERVATION_SOURCE, readingDomainDefinitions } from "./domains/readings.js";

/** Counts the step records of the feature's execution by the step each called, as `Stepper.action`. */
async function stepCounts(world: TWorld): Promise<Map<string, number>> {
	const steps = await readEvery(world.shared.getStore(), { label: SEQ_PATH_LABEL, filters: equalTo({ [SEQ_PATH_FIELD.execution]: executionOf(world.tag) }) });
	const called = steps.map((step) => step[SEQ_PATH_FIELD.called]).filter((one): one is string => typeof one === "string");
	return new Map([...Map.groupBy(called, (one) => one)].map(([one, held]) => [one, held.length]));
}

/** Returns each counted item and its count as a source's items and metrics. */
const observedCounts = (counts: Map<string, number>) => ({ items: [...counts.keys()], metrics: Object.fromEntries([...counts].map(([item, count]) => [item, { count }])) });

/** The built-in observation sources count the step records of the feature's execution: by step, and by stepper. */
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

/** The statements of a quantifier, as `some x in D is S` and `every x observed in S is P` state them. */
const QUANTIFIED = `{what: ${DOMAIN_VARIABLE_NAME}} in {domain: ${DOMAIN_DOMAIN_NAME}} is {statement: ${DOMAIN_STATEMENT}}`;
const OBSERVED = `{what: ${DOMAIN_VARIABLE_NAME}} observed in {source: ${DOMAIN_OBSERVATION_SOURCE}} is {statement: ${DOMAIN_STATEMENT}}`;

export default class LogicStepper extends AStepper implements IHasCycles {
	description = "The logic engine that proves every step, and the readings it evaluates: negation, implication, disjunction, maybe, the quantifiers and repetition";
	steppers: AStepper[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		refuseDeclarations(steppers);
		world.runtime.prover = proverOf(await logicEngine());
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			sources: builtInSources,
			domains: [...logicDomainDefinitions, ...readingDomainDefinitions, ...goalDomainDefinitions, { ...formulaDomainDefinition, refuses: formulaRefusal }],
		}),
	};

	/** What a goal's proof reads, under the caller's authority. */
	private async goalScope(): Promise<TGoalScope> {
		return { ctx: stepperContext(this.getWorld(), this.steppers), engine: await logicEngine(), held: callerHolds() };
	}

	steps = {
		whenever: {
			gwta: `whenever {condition:${DOMAIN_STATEMENT}}, {action:${DOMAIN_STATEMENT}}`,
			description: "Proves the action again while the condition holds, within the engine's bound.",
			reading: READING.whenever,
		},
		where: {
			gwta: `where {condition:${DOMAIN_STATEMENT}}, {action:${DOMAIN_STATEMENT}}`,
			description: "Proves the action where the condition holds, and holds where it doesn't: C → A.",
			reading: READING.where,
		},
		anyOf: { gwta: `any of {alternatives: ${DOMAIN_ALTERNATIVES}}`, description: "Holds where one of the comma-separated statements holds: A ∨ B ∨ C.", reading: READING.anyOf },
		not: {
			gwta: `not {statements:${DOMAIN_STATEMENT}}`,
			description: "Holds where the statement isn't proved, as negation as failure over the results of its line. Its record states whether the statement is refuted or unknown.",
			reading: READING.not,
		},
		maybe: {
			gwta: `maybe {statements:${DOMAIN_STATEMENT}}`,
			description: "Proves the statement and holds whatever its verdict, which its record states: P ∨ ⊤.",
			reading: READING.maybe,
		},
		someObserved: {
			gwta: `some ${OBSERVED}`,
			precludes: ["LogicStepper.some"],
			description: "Holds where the statement holds for an item the observation source returns at this step: ∃x ∈ S. P(x).",
			reading: READING.some,
		},
		some: {
			gwta: `some ${QUANTIFIED}`,
			description: "Holds where the statement holds for a member of the domain: ∃x ∈ D. P(x). An empty domain doesn't have one.",
			reading: READING.some,
		},
		everyObserved: {
			gwta: `every ${OBSERVED}`,
			precludes: ["LogicStepper.every"],
			description: "Holds where the statement holds for every item the observation source returns at this step: ∀x ∈ S. P(x).",
			reading: READING.every,
		},
		every: {
			gwta: `every ${QUANTIFIED}`,
			description: "Holds where the statement holds for every member of the domain: ∀x ∈ D. P(x). It holds over an empty domain.",
			reading: READING.every,
		},
		resolve: {
			gwta: RESOLVE_STATEMENT,
			description:
				"Proves a goal over the producer rules that the steps' signatures state, without calling a step. Returns its verdict, the facts that prove it, the plans that would prove it, and a proved goal's proof as statements. A goal that a fact doesn't prove and a plan doesn't prove is refuted, and the first sub-goal it couldn't prove is refuted under it.",
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string }, featureStep: TFeatureStep) => resolved(await this.goalScope(), featureStep, goal, RESOLVE_STATEMENT),
		},
		pursue: {
			gwta: `pursue {goal: ${DOMAIN_DOMAIN_KEY}}`,
			description:
				"Proves a goal, and where only its plan would prove it, calls each step of its first plan under this step and proves the goal again. A plan whose steps take a value from the caller is walked with walk toward.",
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string }, featureStep: TFeatureStep) => pursued(await this.goalScope(), featureStep, goal),
		},
		walkToward: {
			gwta: `walk toward {goal: ${DOMAIN_DOMAIN_KEY}}`,
			description:
				"Begins a walk toward a goal that isn't proved, held as facts of the walk's graph under the principal that begins it. Returns the step its next advance calls and the parameters that step takes.",
			productsDomain: DOMAIN_CHAIN_WALK,
			action: async ({ goal }: { goal: string }, featureStep: TFeatureStep) => walkBegun(await this.goalScope(), featureStep, goal),
		},
		advanceWalk: {
			gwta: `advance the walk {walk: ${DOMAIN_WALK_ID}} with {args: ${DOMAIN_JSON_OBJECT}}`,
			description:
				"Calls the next step of a walk's plan, as it holds now, under this step with the values given, and holds the fact it asserted. Only the principal that began the walk advances it, since the values are that principal's.",
			productsDomain: DOMAIN_CHAIN_WALK,
			action: async ({ walk, args }: { walk: string; args: Record<string, unknown> }, featureStep: TFeatureStep) => walkAdvanced(await this.goalScope(), featureStep, walk, args),
		},
		showAffordances: {
			gwta: "show affordances",
			description: "Returns the steps the caller may call next and the resolution of each goal a step returns.",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async (_args, featureStep: TFeatureStep) => affordancesAt(await this.goalScope(), featureStep, undefined),
		},
		showAffordancesAsOf: {
			gwta: `show affordances as of {asOf: ${DOMAIN_STEP_PATH}}`,
			description: "Returns the affordances over the facts that held at a step.",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async ({ asOf }: { asOf: number[] }, featureStep: TFeatureStep) => affordancesAt(await this.goalScope(), featureStep, asOf),
		},
		affordancesOnOffer: {
			gwta: "affordances on offer",
			read: true,
			readsAt: Access.public,
			description: "Reads the affordances, as a page does after a step; a read from outside isn't recorded as actuality's step.",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async (_args, featureStep: TFeatureStep) => affordancesAt(await this.goalScope(), featureStep, undefined),
		},
		affordancesOnOfferAsOf: {
			gwta: `affordances on offer as of {asOf: ${DOMAIN_STEP_PATH}}`,
			read: true,
			readsAt: Access.public,
			description: "Reads the affordances over the facts that held at a step.",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async ({ asOf }: { asOf: number[] }, featureStep: TFeatureStep) => affordancesAt(await this.goalScope(), featureStep, asOf),
		},
		showDomainChainLint: {
			gwta: "show chain lint",
			description: "Returns the step graph's lint findings, queries over the steps' signatures, with the chain they read.",
			productsDomain: DOMAIN_CHAIN_LINT,
			action: async () => chainLint(await this.goalScope()),
		},
		showDerivation: {
			gwta: `show derivation of {statement: ${DOMAIN_STATEMENT}}`,
			description:
				"Proves a statement of one step under this step, and returns its verdict, the records its proof wrote, the calls among them with the actions that allowed each, and the line of the first goal it couldn't prove.",
			productsDomain: DOMAIN_DERIVATION,
			action: async ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				if (statement.length !== 1) return actionNotOK(`show derivation of: the statement holds ${statement.length} steps; state one step`);
				return actionOKWithProducts(await derivationUnder(stepperContext(this.getWorld(), this.steppers), featureStep, itemAt(statement, 0)));
			},
		},
		lineRendersAsWritten: {
			read: true,
			readsAt: Access.public,
			gwta: `line {line: ${DOMAIN_TEXT}} renders from its term as written`,
			description: "Parses a line to its term through the step it resolves to, renders the term through the same step's pattern, and holds where the line renders as written.",
			productsDomain: DOMAIN_LINE_TERM,
			action: ({ line }: { line: string }) => {
				const { term, rendered } = lineTerm(this.getWorld(), this.steppers, line);
				return rendered === line ? actionOKWithProducts({ line, term, rendered }) : actionNotOK(`the line "${line}" renders from its term ${term} as "${rendered}"`);
			},
		},
		callIsLine: {
			read: true,
			readsAt: Access.public,
			gwta: `call {method: ${DOMAIN_STEP_METHOD}} with {input: ${DOMAIN_JSON}} is the line {line: ${DOMAIN_TEXT}}`,
			description: "Holds where a call a transport carries, a method with its named parameters, and a line parse to the same term, as a model's tool call and a line do.",
			action: ({ method, input, line }: { method: string; input: Record<string, unknown>; line: string }) => {
				const world = this.getWorld();
				const [call, written] = [callTerm(world, method, input), lineTerm(world, this.steppers, line).term];
				return call === written ? actionOK() : actionNotOK(`the call ${method} parses to ${call}, and the line "${line}" parses to ${written}`);
			},
		},
		rule: {
			read: true,
			readsAt: Access.public,
			gwta: `rule {formula: ${DOMAIN_FORMULA}}`,
			description:
				"Enters one TPTP FOF formula for a complex single-purpose rule, and returns its name, its role and its rendering in Unicode notation. A line resolves only where the formula parses, is in the engine's fragment and names entries of the registry; other lines name the rule.",
			productsDomain: DOMAIN_RULE,
			action: ({ formula }: { formula: string }) => {
				const rule = ruleOf(formula, this.steppers);
				return "refused" in rule ? actionNotOK(rule.refused) : actionOKWithProducts(rule);
			},
		},
	} as const satisfies TStepperSteps;
}
