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
import {
	DOMAIN_STATEMENT,
	DOMAIN_TEXT,
	DOMAIN_VARIABLE_NAME,
	DOMAIN_DOMAIN_NAME,
	DOMAIN_STEP_METHOD,
	DOMAIN_JSON,
	DOMAIN_DOMAIN_KEY,
	DOMAIN_JSON_OBJECT,
	namesMember,
} from "@haibun/core/lib/domains/domains.js";
import { actionNotOK, actionOK, actionOKWithProducts, actionUnknown, errorDetail } from "@haibun/core/lib/domains/util.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { ACTIVITIES_STEPPER } from "@haibun/core/steps/domains/activities-actions.js";
import { z } from "zod";
import { Access, SEQ_PATH_LABEL, type TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD, calledParts, actualityFeatureOf } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { callerHolds, readingAsOf } from "@haibun/core/lib/domains/capability-context.js";
import { DOMAIN_APPLICABLE_STEPS, DOMAIN_GOAL_RESOLUTION, DOMAIN_PLAN_ID, DOMAIN_PLAN_PROGRESS, goalDomainDefinitions } from "@haibun/core/lib/domains/goal-resolution.js";
import { applicableStepsAt, ensured, planAdvanced, planBegun, resolved, type TGoalScope } from "./pipelines/goals.js";
import { stepperContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { proverOf } from "./pipelines/prove.js";
import { recordsWhere } from "./pipelines/reads.js";
import { callTerm, derivationUnder, lineTerm, refuseDeclarations } from "./pipelines/registry-reads.js";
import { logicEngine, reasoner } from "./root.js";
import { checkedExpression, countedMembers, entailedMembers, expressionCompletions, expressionReading, queryBasis, subsumptionRefusal, truncationOf } from "./pipelines/members.js";
import { DOMAIN_INDIVIDUAL_ADDRESS, type TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import { DOMAIN_CLASS_EXPRESSION, DOMAIN_ENTAILED_MEMBERS, classExpressionDomainDefinition, reasoningDomainDefinitions } from "./domains/reasoning.js";
import { DOMAIN_DERIVATION, DOMAIN_DOMAIN_GOAL, DOMAIN_LINE_TERM, RESOLVE_STATEMENT, logicDomainDefinitions } from "./domains/logic.js";
import { DOMAIN_ALTERNATIVES, DOMAIN_OBSERVATION_SOURCE, DOMAIN_REFUSAL, DOMAIN_STATUS, readingDomainDefinitions } from "./domains/readings.js";

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
		world.runtime.prover = proverOf(await logicEngine(), reasoner());
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			sources: [steps],
			domains: [...logicDomainDefinitions, ...readingDomainDefinitions, ...goalDomainDefinitions, ...reasoningDomainDefinitions, this.classExpressionDomain, this.domainGoalDomain],
		}),
	};

	/** The class expression domain, whose refusal holds an expression to the fragment a query evaluates and to the ontology's names. */
	private readonly classExpressionDomain: TDomainDefinition = {
		...classExpressionDomainDefinition,
		reading: (text) => expressionReading(text, this.getWorld().domains),
		completions: (text) => expressionCompletions(text, this.getWorld().domains),
		refuses: (text) => {
			try {
				checkedExpression(text, queryBasis(this.getWorld().domains));
				return undefined;
			} catch (caught) {
				return errorDetail(caught);
			}
		},
	};

	/** The domain goal ensure takes, whose refusal of a term that doesn't name a registered domain leaves a line that states a
	 *  waypoint's head to the activities' ensure. */
	private readonly domainGoalDomain: TDomainDefinition = {
		selectors: [DOMAIN_DOMAIN_GOAL],
		schema: z.string().min(1),
		description: "A domain goal: a registered domain's key, whose fact ensure makes hold by the goal's plan",
		refuses: (term) => (this.domainKeys().includes(term) ? undefined : `"${term}" doesn't name a registered domain; the Domain records list them`),
		completions: (term) => this.domainKeys().filter((key) => key.startsWith(term)),
	};

	/** The keys of the registered domains, as the domain key's domain names them. */
	private domainKeys(): string[] {
		const { domains } = this.getWorld();
		return Object.keys(domains).filter((key) => namesMember(domains[DOMAIN_DOMAIN_KEY], key));
	}

	/** The members a class expression entails over the world's store, under the caller's authority. */
	private members(expression: string) {
		const world = this.getWorld();
		return entailedMembers(reasoner(), world.shared.getStore(), world.domains, world.runtime.records, expression);
	}

	/** What a goal's proof reads, under the caller's authority. */
	private goalScope(): TGoalScope {
		return { ctx: stepperContext(this.getWorld(), this.steppers), reasoner: reasoner(), held: callerHolds(), stepper: this.constructor.name };
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
		didnt: {
			gwta: `didn't {statements:${DOMAIN_STATEMENT}}`,
			description:
				"Holds where the statement didn't succeed, as negation as failure over the results of its line in actuality, a closed world. Its products hold the failure: its failing step's error text as refusal, and that step's seqPath, so a feature that expects a failure confirms it was the expected error with set … from didn't … and then matches ….refusal with the error's pattern. Its record states whether the statement is refuted or unknown.",
			productsDomain: DOMAIN_REFUSAL,
			reading: READING.didnt,
		},
		maybe: {
			gwta: `maybe {statements:${DOMAIN_STATEMENT}}`,
			description: "Proves the statement and holds whatever its verdict, which its record states and it returns: P ∨ ⊤.",
			productsDomain: DOMAIN_STATUS,
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
				"Proves a goal over the producer rules that the steps' signatures state, without calling a step. Returns its verdict, the facts that prove it, the plans that would prove it, and a proved goal's proof as statements. A goal that lacks both a fact and a plan is unknown, and the first sub-goal it couldn't prove is proved under it.",
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: ({ goal }: { goal: string }, featureStep: TFeatureStep) => resolved(this.goalScope(), featureStep, goal, RESOLVE_STATEMENT),
		},
		ensure: {
			gwta: `ensure {goal: ${DOMAIN_DOMAIN_GOAL}}`,
			precludes: [`${ACTIVITIES_STEPPER}.ensure`],
			unique: true,
			description:
				"Proves a domain goal, and where only its plan would prove it, calls each step of its first plan under this step and proves the goal again. A plan whose steps take a value from the caller is advanced one step at a time with plan. A line that states a waypoint's head ensures the waypoint.",
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: ({ goal }: { goal: string }, featureStep: TFeatureStep) => ensured(this.goalScope(), featureStep, goal),
		},
		plan: {
			gwta: `plan {goal: ${DOMAIN_DOMAIN_KEY}}`,
			description:
				"Writes a plan toward a goal that isn't proved, the steps that would make it hold, held as facts of the plan's graph under the principal that begins it. Returns the step its next advance calls and the parameters that step takes.",
			productsDomain: DOMAIN_PLAN_PROGRESS,
			action: ({ goal }: { goal: string }, featureStep: TFeatureStep) => planBegun(this.goalScope(), featureStep, goal),
		},
		advancePlan: {
			gwta: `advance plan {plan: ${DOMAIN_PLAN_ID}} with {args: ${DOMAIN_JSON_OBJECT}}`,
			description:
				"Calls the next step of a plan, as it holds now, under this step with the values given, and holds the fact it asserted. Only the principal that began the plan advances it, since the values are that principal's.",
			productsDomain: DOMAIN_PLAN_PROGRESS,
			action: ({ plan, args }: { plan: string; args: Record<string, unknown> }, featureStep: TFeatureStep) => planAdvanced(this.goalScope(), featureStep, plan, args),
		},
		showApplicableSteps: {
			gwta: "show the applicable steps",
			description: "Returns the steps the caller may call next and the resolution of each goal a step returns, over the facts that hold now, or, under `as of`, at a step.",
			productsDomain: DOMAIN_APPLICABLE_STEPS,
			action: (_args, featureStep: TFeatureStep) => applicableStepsAt(this.goalScope(), featureStep, readingAsOf()),
		},
		applicableSteps: {
			gwta: "applicable steps",
			read: true,
			readsAt: Access.public,
			description: "Reads the applicable steps, as a page does after a step, now, or, under `as of`, at a step; a read from outside isn't recorded as actuality's step.",
			productsDomain: DOMAIN_APPLICABLE_STEPS,
			action: (_args, featureStep: TFeatureStep) => applicableStepsAt(this.goalScope(), featureStep, readingAsOf()),
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
		individualsOf: {
			read: true,
			readsAt: Access.public,
			gwta: `individuals of {expression: ${DOMAIN_CLASS_EXPRESSION}}`,
			description:
				"Returns the records a class expression entails as its members, through the reasoner over the ontology and the records an expression's names reach, under the caller's authority. A member the records don't entail may exist.",
			productsDomain: DOMAIN_ENTAILED_MEMBERS,
			action: async ({ expression }: { expression: string }) => {
				return actionOKWithProducts(countedMembers(await this.members(expression)));
			},
		},
		individualIsA: {
			read: true,
			readsAt: Access.public,
			gwta: `individual {address: ${DOMAIN_INDIVIDUAL_ADDRESS}} is a {expression: ${DOMAIN_CLASS_EXPRESSION}}`,
			description:
				"Holds where the reasoner entails the record at an address as a member of a class expression. A membership the records don't entail is unknown, which isn't false in the open world, so the claim fails closed.",
			action: async ({ address, expression }: { address: TIndividualAddress; expression: string }) => {
				const entailed = await this.members(expression);
				if (entailed.members.some(({ persistedAs, id }) => persistedAs === address.persistedAs && id === address.id)) return actionOK();
				return actionUnknown(
					`${address.persistedAs}:${address.id} ∈ ${expression} is unknown: the records don't entail it, and unknown isn't false in the open world.${truncationOf(entailed)} Add the fact, or read a complete graph.`,
				);
			},
		},
		everyIsA: {
			read: true,
			readsAt: Access.public,
			gwta: `every {sub: ${DOMAIN_CLASS_EXPRESSION}} is a {sup: ${DOMAIN_CLASS_EXPRESSION}}`,
			description:
				"Holds where the ontology entails that every member of the first class expression is a member of the second. Fails closed otherwise, and its products hold the witness as data: the subsumption that doesn't hold and the entailed members of the first that the second doesn't hold.",
			action: async ({ sub, sup }: { sub: string; sup: string }) => {
				const world = this.getWorld();
				const refused = await subsumptionRefusal(reasoner(), world.shared.getStore(), world.domains, world.runtime.records, sub, sup);
				return refused === undefined ? actionOK() : { ...actionUnknown(refused.refusal), products: { witness: refused.witness } };
			},
		},
		someOf: {
			read: true,
			readsAt: Access.public,
			gwta: `some {expression: ${DOMAIN_CLASS_EXPRESSION}}`,
			description: "Holds where the reasoner entails a member of a class expression. Without one the claim is unknown, which isn't false in the open world, so it fails closed.",
			productsDomain: DOMAIN_ENTAILED_MEMBERS,
			action: async ({ expression }: { expression: string }) => {
				const entailed = await this.members(expression);
				if (entailed.members.length > 0) return actionOKWithProducts(countedMembers(entailed));
				return actionUnknown(
					`some ${expression} is unknown: the records don't entail a member, and unknown isn't false in the open world.${truncationOf(entailed)} Add the fact, or read a complete graph.`,
				);
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
	} as const satisfies TStepperSteps;
}
