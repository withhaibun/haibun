import {
	AStepper,
	READING,
	observedOf,
	type IHasCycles,
	type IObservationSource,
	type IStepperCycles,
	type TFeatureStep,
	type TStepperSteps,
} from "@haibun/core/lib/steps/domains/stepper.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";
import type { TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import {
	DOMAIN_STATEMENT,
	DOMAIN_TEXT,
	DOMAIN_VARIABLE_NAME,
	DOMAIN_DOMAIN_NAME,
	DOMAIN_STEP_METHOD,
	DOMAIN_JSON,
	DOMAIN_DOMAIN_KEY,
	DOMAIN_JSON_OBJECT,
	DOMAIN_WAYPOINT_ARGUMENT,
} from "@haibun/core/lib/domains/domains.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { argumentsOf } from "@haibun/core/lib/steps/pipelines/populate-action-args.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { Access, SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD, calledParts, actualityFeatureOf, stepRecordOf } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { callerHolds, readingAsOf } from "@haibun/core/lib/domains/capability-context.js";
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
import { canonicalOf, readerOf, recordsWhere, writeFacts } from "./pipelines/reads.js";
import { callTerm, derivationUnder, formulaRefusal, lineTerm, refuseDeclarations, ruleOf } from "./pipelines/registry-reads.js";
import { logicEngine } from "./root.js";
import {
	DOMAIN_DERIVATION,
	DOMAIN_FORMULA,
	DOMAIN_LINE_TERM,
	DOMAIN_RULE,
	READ_GRAPH,
	READ_PREDICATE,
	RESOLVE_STATEMENT,
	formulaDomainDefinition,
	logicDomainDefinitions,
} from "./domains/logic.js";
import { DOMAIN_ALTERNATIVES, DOMAIN_OBSERVATION_SOURCE, DOMAIN_STATUS, readingDomainDefinitions } from "./domains/readings.js";

/** The feature's step records as an observation source: each record's fields, the stepper of the step it called, and its
 *  duration, from its start to its end in milliseconds, where it ended. */
const steps: IObservationSource = {
	name: "steps",
	observe: async (world: TWorld) =>
		(await recordsWhere(world.shared.getStore(), SEQ_PATH_LABEL, SEQ_PATH_FIELD.actuality, actualityFeatureOf(world.tag))).flatMap((record) => {
			const { [SEQ_PATH_FIELD.called]: called, [SEQ_PATH_FIELD.generatedAtTime]: started, [SEQ_PATH_FIELD.endedAtTime]: ended } = record;
			const stepper = typeof called === "string" ? calledParts(called).stepperName : undefined;
			const duration = typeof ended === "string" && typeof started === "string" ? Date.parse(ended) - Date.parse(started) : undefined;
			return observedOf(String(record[SEQ_PATH_FIELD.id]), { ...record, stepper, duration });
		}),
};

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

	/** The formula domain, whose refusal holds a written formula to the registry of the steppers and the world's domains. */
	private readonly formulaDomain: TDomainDefinition = { ...formulaDomainDefinition, refuses: (text, steppers) => formulaRefusal(text, steppers, this.getWorld().domains) };

	cycles: IStepperCycles = {
		getConcerns: () => ({ sources: [steps], domains: [...logicDomainDefinitions, ...readingDomainDefinitions, ...goalDomainDefinitions, this.formulaDomain] }),
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
			description: "Proves the statement and holds whatever its verdict, which its record states and it returns: P ∨ ⊤.",
			productsDomain: DOMAIN_STATUS,
			reading: READING.maybe,
		},
		absent: {
			gwta: `absent {statement: ${DOMAIN_STATEMENT}}`,
			description:
				"States the falsity of a goal, a line that unifies with a waypoint's head: the goal is refuted where its proof doesn't hold, and a contradiction where its proof holds.",
			action: async ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const [goal] = statement;
				const head = goal?.action.step.rule?.head;
				if (statement.length !== 1 || goal === undefined || head === undefined)
					return actionNotOK(`\`${featureStep.in}\` doesn't state one waypoint's head to deny. State one line that matches a waypoint's head after absent.`);
				const world = this.getWorld();
				const read = await argumentsOf(goal, world, this.steppers);
				if ("refused" in read) return actionNotOK(read.refused);
				const store = world.shared.getStore();
				const canonical = await canonicalOf(readerOf(store));
				const args = Object.fromEntries(Object.entries(read.args).map(([name, value]) => [name, canonical(String(value))]));
				await writeFacts(store, stepRecordOf(world.tag, featureStep.seqPath), READ_GRAPH.falsity, { [READ_PREDICATE.head]: head, ...args });
				return OK;
			},
		},
		sameAs: {
			gwta: `{individual: ${DOMAIN_WAYPOINT_ARGUMENT}} is the same as {other: ${DOMAIN_WAYPOINT_ARGUMENT}}`,
			description: "States that two individuals are one, so a goal reads each as its canonical representative: the first in order of the individuals stated the same.",
			action: async ({ individual, other }: { individual: string; other: string }) => {
				await writeFacts(this.getWorld().shared.getStore(), individual, READ_GRAPH.same, { [READ_PREDICATE.sameAs]: other });
				return OK;
			},
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
			description: "Returns the steps the caller may call next and the resolution of each goal a step returns, over the facts that hold now, or, under `as of`, at a step.",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async (_args, featureStep: TFeatureStep) => affordancesAt(await this.goalScope(), featureStep, readingAsOf()),
		},
		affordancesOnOffer: {
			gwta: "affordances on offer",
			read: true,
			readsAt: Access.public,
			description: "Reads the affordances, as a page does after a step, now, or, under `as of`, at a step; a read from outside isn't recorded as actuality's step.",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async (_args, featureStep: TFeatureStep) => affordancesAt(await this.goalScope(), featureStep, readingAsOf()),
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
				if (statement.length !== 1) return actionNotOK(`\`${featureStep.in}\` states ${statement.length} steps. State one step to show its derivation.`);
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
				if (rendered === line) return actionOKWithProducts({ line, term, rendered });
				return actionNotOK(`\`${line}\` renders from its term ${term} as \`${rendered}\`. Give its step a pattern that renders the line as written.`);
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
				if (call === written) return actionOK();
				return actionNotOK(`The call ${method} parses to ${call}, and \`${line}\` parses to ${written}. Give the call the values the line states.`);
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
				const rule = ruleOf(formula, this.steppers, this.getWorld().domains);
				return "refused" in rule ? actionNotOK(rule.refused) : actionOKWithProducts(rule);
			},
		},
	} as const satisfies TStepperSteps;
}
