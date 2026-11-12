import { AStepper, READING, type IHasCycles, type IHasOptions, type IStepperCycles, type TFeatureStep, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
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
import { actionNotOK, actionOK, actionOKWithProducts, errorDetail, getStepperOption } from "@haibun/core/lib/domains/util.js";
import { VOCABULARY_ENTRIES, vocabularyEntry } from "@haibun/core/lib/domains/vocabulary-registry.js";
import { itemAt, valueAt } from "@haibun/core/lib/domains/item-at.js";
import { ACTIVITIES_STEPPER } from "@haibun/core/steps/domains/activities-actions.js";
import { z } from "zod";
import { Access, type TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_ACCESS } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { inCall } from "@haibun/core/lib/domains/capability-context.js";
import { DOMAIN_APPLICABLE_STEPS, DOMAIN_GOAL_RESOLUTION, DOMAIN_PLAN_ID, DOMAIN_PLAN_PROGRESS, goalDomainDefinitions } from "@haibun/core/lib/domains/goal-resolution.js";
import { stepMembers } from "./pipelines/reads.js";
import { applicableStepsAt, ensured, planAdvanced, planBegun, resolved, type TGoalScope } from "./pipelines/goals.js";
import { stepperContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { proverOf } from "./pipelines/prove.js";
import { callTerm, derivationOfRecord, derivationUnder, lineTerm, refuseDeclarations } from "./pipelines/registry-reads.js";
import { declareVocabularies, logicEngine, reasoner } from "./root.js";
import { checkedExpression, countedMembers, entailedMembers, expressionCompletions, expressionReading, queryBasis } from "./pipelines/members.js";
import { claimEntailment, instanceChecked, retrievalChecked, subsumptionChecked, type TClaimScope } from "./pipelines/claims.js";
import { featureClaim } from "./pipelines/feature-claims.js";
import { DOMAIN_INDIVIDUAL_ADDRESS, type TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import {
	DOMAIN_CLAIM,
	DOMAIN_CLAIMED_FEATURE,
	DOMAIN_CLASS_EXPRESSION,
	DOMAIN_CONTRACT_CLAIM,
	DOMAIN_ENTAILED_MEMBERS,
	classExpressionDomainDefinition,
	reasoningDomainDefinitions,
} from "./domains/reasoning.js";
import { DOMAIN_DERIVATION, DOMAIN_DOMAIN_GOAL, DOMAIN_LINE_TERM, RESOLVE_STATEMENT, logicDomainDefinitions } from "./domains/logic.js";
import { DOMAIN_ALTERNATIVES, DOMAIN_REFUSAL, DOMAIN_STATUS, readingDomainDefinitions } from "./domains/readings.js";
import { NEGATION_GWTA } from "@haibun/core/lib/steps/domains/contract.js";

/** The feature's step records, as the members of the steps domain. */
const steps: TDomainDefinition = {
	selectors: ["steps"],
	schema: z.string().min(1),
	description: "The step records of this feature, each with the stepper of the step it called and its duration in milliseconds",
	members: stepMembers,
};

/** What a claim's terms are named in a fault where its line lacks one its pattern names. */
const CLAIM_TERMS = "the terms of a claim's line";

/** The statements of a quantifier, as `some x in D is S` states them. */
const QUANTIFIED = `{what: ${DOMAIN_VARIABLE_NAME}} in {domain: ${DOMAIN_DOMAIN_NAME}} is {statement: ${DOMAIN_STATEMENT}}`;

export default class LogicStepper extends AStepper implements IHasCycles, IHasOptions {
	description = "The logic engine that proves every step, and the readings it evaluates: negation, implication, disjunction, maybe, the quantifiers and repetition";
	steppers: AStepper[] = [];

	options = {
		VOCABULARIES: {
			desc: `The standard vocabularies whose axioms the reasoner reads beside the ontology, comma-separated, of those the vocabulary registry holds: ${VOCABULARY_ENTRIES.map((entry) => entry.prefix).join(", ")}. Unset, the reasoner reads the ontology alone`,
			parse: (input: string) => {
				const named = input.split(",").map((prefix) => prefix.trim());
				const unheld = named.filter((prefix) => !VOCABULARY_ENTRIES.some((entry) => entry.prefix === prefix));
				return unheld.length === 0 ? { result: named } : { parseError: `VOCABULARIES: the registry doesn't hold ${unheld.join(", ")}` };
			},
		},
	};

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		refuseDeclarations(steppers);
		world.runtime.prover = proverOf(await logicEngine(), reasoner(), steppers);
	}

	cycles: IStepperCycles = {
		// The vocabularies a deployment declares are read as actuality starts, where its options are held.
		startActuality: () => {
			const declared = getStepperOption(this, "VOCABULARIES", this.getWorld().moduleOptions);
			if (declared !== undefined) declareVocabularies(declared.split(",").map((prefix) => vocabularyEntry(prefix.trim()).prefix));
		},
		getConcerns: () => ({
			domains: [
				steps,
				...logicDomainDefinitions,
				...readingDomainDefinitions,
				...goalDomainDefinitions,
				...reasoningDomainDefinitions,
				this.classExpressionDomain,
				this.domainGoalDomain,
			],
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

	/** What a claim reads over the world's store, under the caller's authority. */
	private claimScope(): TClaimScope {
		const world = this.getWorld();
		return { reasoner: reasoner(), store: world.shared.getStore(), domains: world.domains, records: world.runtime.records };
	}

	/** The members a class expression entails over the world's store, under the caller's authority. */
	private members(expression: string) {
		const { reasoner: reads, store, domains, records } = this.claimScope();
		return entailedMembers(reads, store, domains, records, expression);
	}

	/** What a goal's proof reads, under the caller's authority. */
	private goalScope(): TGoalScope {
		return { ctx: stepperContext(this.getWorld(), this.steppers), reasoner: reasoner(), held: inCall()?.held, stepper: this.constructor.name };
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
			gwta: NEGATION_GWTA,
			description:
				"Holds where its statement is refuted, is unknown where its statement is unknown, and is refuted where its statement is proved. It negates a step's line and a statement of facts, such as `didn't {capability} is revoked`. A missing fact makes a statement refuted only where its relation is declared complete. Its products hold the failure: its failing step's error text as refusal, and that step's seqPath, so a feature that expects a failure confirms it was the expected error with set … from didn't … and then matches ….refusal with the error's pattern. Its record states its verdict.",
			contract: { products: DOMAIN_REFUSAL },
			reading: READING.didnt,
		},
		maybe: {
			gwta: `maybe {statements:${DOMAIN_STATEMENT}}`,
			description: "Proves the statement and holds whatever its verdict, which its record states and it returns: P ∨ ⊤.",
			contract: { products: DOMAIN_STATUS },
			reading: READING.maybe,
		},
		some: {
			gwta: `some ${QUANTIFIED}`,
			description:
				"Holds where the statement holds for a member of the domain: ∃x ∈ D. P(x). An empty domain doesn't have one. A member's fields are read as x.field, and a list combinator stated before it, such as whose, selects the members.",
			reading: READING.some,
		},
		every: {
			gwta: `every ${QUANTIFIED}`,
			description:
				"Holds where the statement holds for every member of the domain: ∀x ∈ D. P(x). It holds over an empty domain. A member's fields are read as x.field, and a list combinator stated before it, such as whose, selects the members.",
			reading: READING.every,
		},
		resolve: {
			gwta: RESOLVE_STATEMENT,
			description:
				"Proves a goal over the producer rules that the steps' signatures state, without calling a step. Returns its verdict, the facts that prove it, the plans that would prove it, and a proved goal's proof as statements. A goal that lacks both a fact and a plan is unknown, and the first sub-goal it couldn't prove is proved under it.",
			contract: { products: DOMAIN_GOAL_RESOLUTION },
			action: ({ goal }: { goal: string }, featureStep: TFeatureStep) => resolved(this.goalScope(), featureStep, goal, RESOLVE_STATEMENT),
		},
		ensure: {
			gwta: `ensure {goal: ${DOMAIN_DOMAIN_GOAL}}`,
			precludes: [`${ACTIVITIES_STEPPER}.ensure`],
			unique: true,
			description:
				"Proves a domain goal, and where only its plan would prove it, calls each step of its first plan under this step and proves the goal again. A plan whose steps take a value from the caller is advanced one step at a time with plan. A line that states a waypoint's head ensures the waypoint.",
			contract: { products: DOMAIN_GOAL_RESOLUTION },
			action: ({ goal }: { goal: string }, featureStep: TFeatureStep) => ensured(this.goalScope(), featureStep, goal),
		},
		plan: {
			gwta: `plan {goal: ${DOMAIN_DOMAIN_KEY}}`,
			description:
				"Writes a plan toward a goal that isn't proved, the steps that would make it hold, held as facts of the plan's graph under the principal that begins it. Returns the step its next advance calls and the parameters that step takes.",
			contract: { products: DOMAIN_PLAN_PROGRESS },
			action: ({ goal }: { goal: string }, featureStep: TFeatureStep) => planBegun(this.goalScope(), featureStep, goal),
		},
		advancePlan: {
			gwta: `advance plan {plan: ${DOMAIN_PLAN_ID}} with {args: ${DOMAIN_JSON_OBJECT}}`,
			description:
				"Calls the next step of a plan, as it holds now, under this step with the values given, and holds the fact it asserted. Only the principal that began the plan advances it, since the values are that principal's.",
			contract: { products: DOMAIN_PLAN_PROGRESS },
			action: ({ plan, args }: { plan: string; args: Record<string, unknown> }, featureStep: TFeatureStep) => planAdvanced(this.goalScope(), featureStep, plan, args),
		},
		showApplicableSteps: {
			gwta: "show the applicable steps",
			description: "Returns the steps the caller may call next and the resolution of each goal a step returns, over the facts that hold now, or, under `as of`, at a step.",
			contract: { products: DOMAIN_APPLICABLE_STEPS },
			action: (_args, featureStep: TFeatureStep) => applicableStepsAt(this.goalScope(), featureStep, inCall()?.asOf),
		},
		applicableSteps: {
			gwta: "applicable steps",
			readsAt: Access.public,
			description: "Reads the applicable steps, as a page does after a step, now, or, under `as of`, at a step; a read from outside isn't recorded as actuality's step.",
			contract: { read: true, products: DOMAIN_APPLICABLE_STEPS },
			action: (_args, featureStep: TFeatureStep) => applicableStepsAt(this.goalScope(), featureStep, inCall()?.asOf),
		},
		showDerivation: {
			gwta: `show derivation of {statement: ${DOMAIN_STATEMENT}}`,
			description:
				"Proves a statement of one step under this step, and returns its verdict, the records its proof wrote, the calls among them with the actions that allowed each, and the line of the first goal it couldn't prove.",
			contract: { products: DOMAIN_DERIVATION },
			action: async ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				if (statement.length !== 1) return actionNotOK(`\`${featureStep.in}\` states ${statement.length} steps. State one step to show its derivation.`);
				return actionOKWithProducts(await derivationUnder(stepperContext(this.getWorld(), this.steppers), reasoner(), featureStep, itemAt(statement, 0)));
			},
		},
		recordedDerivation: {
			readsAt: SEQ_PATH_ACCESS,
			gwta: `derivation of step {step: ${DOMAIN_INDIVIDUAL_ADDRESS}}`,
			description:
				"Reads the derivation of a step actuality recorded, from the records its proof wrote, without proving it again: its verdict, the frames of its records, the calls among them with the actions that allowed each, and the line of the first goal it couldn't prove.",
			contract: { read: true, products: DOMAIN_DERIVATION },
			action: async ({ step }: { step: TIndividualAddress }) => actionOKWithProducts(await derivationOfRecord(this.getWorld(), this.steppers, reasoner(), step)),
		},
		individualsOf: {
			readsAt: Access.public,
			gwta: `individuals of {expression: ${DOMAIN_CLASS_EXPRESSION}}`,
			description:
				"Returns the records a class expression entails as its members, through the reasoner over the ontology and the records an expression's names reach, under the caller's authority. A member the records don't entail may exist.",
			contract: { read: true, products: DOMAIN_ENTAILED_MEMBERS },
			action: async ({ expression }: { expression: string }) => {
				return actionOKWithProducts(countedMembers(await this.members(expression)));
			},
		},
		individualIsA: {
			readsAt: Access.public,
			gwta: `individual {address: ${DOMAIN_INDIVIDUAL_ADDRESS}} is a {expression: ${DOMAIN_CLASS_EXPRESSION}}`,
			description:
				"An instance check: holds where the reasoner entails ClassAssertion(E X), the record at an address as a member of a class expression, and is refuted where the membership implies two classes an axiom states disjoint, naming the axioms. A membership the records don't entail and don't contradict is unknown, which isn't false in the open world, so the claim fails closed.",
			contract: { read: true, products: DOMAIN_CLAIM },
			entails: (terms) => claimEntailment({ individual: valueAt(terms, "address", CLAIM_TERMS), expression: valueAt(terms, "expression", CLAIM_TERMS) }, this.getWorld().domains),
			action: ({ address, expression }: { address: TIndividualAddress; expression: string }) => instanceChecked(this.claimScope(), address, expression),
		},
		everyIsA: {
			readsAt: Access.public,
			gwta: `every {sub: ${DOMAIN_CLASS_EXPRESSION}} is a {sup: ${DOMAIN_CLASS_EXPRESSION}}`,
			description:
				"A subsumption check: holds where the ontology entails SubClassOf(E1 E2), that every member of the first class expression is a member of the second, and is refuted where the records entail a member of the first and the two expressions are entailed disjoint. Fails closed otherwise, and its products hold the witness as data: the subsumption that isn't entailed and the entailed members of the first that the second doesn't hold.",
			contract: { read: true, products: DOMAIN_CLAIM },
			entails: (terms) => claimEntailment({ sub: valueAt(terms, "sub", CLAIM_TERMS), sup: valueAt(terms, "sup", CLAIM_TERMS) }, this.getWorld().domains),
			action: ({ sub, sup }: { sub: string; sup: string }) => subsumptionChecked(this.claimScope(), sub, sup),
		},
		someOf: {
			readsAt: Access.public,
			gwta: `some {expression: ${DOMAIN_CLASS_EXPRESSION}}`,
			description:
				"An instance retrieval: holds where the reasoner entails a named individual as a member of a class expression, which its products name as the witness. Without one the claim is unknown, which isn't false in the open world, so it fails closed.",
			contract: { read: true, products: DOMAIN_ENTAILED_MEMBERS },
			entails: (terms) => claimEntailment({ some: valueAt(terms, "expression", CLAIM_TERMS) }, this.getWorld().domains),
			action: ({ expression }: { expression: string }) => retrievalChecked(this.claimScope(), expression),
		},
		featureEntails: {
			readsAt: Access.public,
			gwta: `feature {feature: ${DOMAIN_CLAIMED_FEATURE}} entails {claim: ${DOMAIN_CONTRACT_CLAIM}}`,
			description:
				"A claim over a background's contracts: binds each parameter of its steps that an earlier step's products don't supply to a fresh individual of its declared domain, chains the steps' `requires` and `states` in order, and holds where the relations' rules derive the claim, a statement as `relation(variable, …)`, for every value of those domains. It is refuted where a contract states the claim's negation, and unknown otherwise, naming the first fact between the claim's individuals that the chain doesn't derive.",
			contract: { read: true, products: DOMAIN_CLAIM },
			action: ({ feature, claim }: { feature: string; claim: string }) => featureClaim(this.getWorld(), this.steppers, reasoner(), feature, claim),
		},
		lineRendersAsWritten: {
			readsAt: Access.public,
			gwta: `line {line: ${DOMAIN_TEXT}} renders from its term as written`,
			description: "Parses a line to its term through the step it resolves to, renders the term through the same step's pattern, and holds where the line renders as written.",
			contract: { read: true, products: DOMAIN_LINE_TERM },
			action: ({ line }: { line: string }) => {
				const { term, rendered } = lineTerm(this.getWorld(), this.steppers, line);
				if (rendered === line) return actionOKWithProducts({ line, term, rendered });
				return actionNotOK(`\`${line}\` renders from its term ${term} as \`${rendered}\`. Give its step a pattern that renders the line as written.`);
			},
		},
		callIsLine: {
			contract: { read: true },
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
