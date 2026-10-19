import { AStepper, READING, type IHasCycles, type IObservationSource, type IStepperCycles, type TFeatureStep, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";
import { DOMAIN_STATEMENT, DOMAIN_TEXT, DOMAIN_VARIABLE_NAME, DOMAIN_DOMAIN_NAME, DOMAIN_STEP_METHOD, DOMAIN_JSON } from "@haibun/core/lib/domains/domains.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { readEvery, equalTo } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { Access, SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD, calledParts, executionOf } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { stepperContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { proverOf } from "./pipelines/prove.js";
import { callTerm, derivationUnder, formulaChecked, lineTerm, refuseDeclarations } from "./pipelines/registry-reads.js";
import { logicEngine } from "./root.js";
import { DOMAIN_DERIVATION, DOMAIN_FORMULA_CHECK, DOMAIN_LINE_TERM, logicDomainDefinitions } from "./domains/logic.js";
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
		if (world.runtime.prover === undefined) world.runtime.prover = proverOf(await logicEngine());
	}

	cycles: IStepperCycles = { getConcerns: () => ({ sources: builtInSources, domains: [...logicDomainDefinitions, ...readingDomainDefinitions] }) };

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
		checkFormula: {
			read: true,
			readsAt: Access.public,
			gwta: `check the formula {formula: ${DOMAIN_TEXT}}`,
			description:
				"Parses a TPTP FOF formula and checks it against the engine's fragment. Returns its rendering in Unicode notation, or why the fragment refuses it and the remedy.",
			productsDomain: DOMAIN_FORMULA_CHECK,
			action: ({ formula }: { formula: string }) => actionOKWithProducts(formulaChecked(formula)),
		},
		formulaRendersAs: {
			read: true,
			readsAt: Access.public,
			gwta: `formula {formula: ${DOMAIN_TEXT}} renders as {rendered: ${DOMAIN_TEXT}}`,
			description: "Holds where a TPTP FOF formula in the engine's fragment renders in Unicode notation as stated.",
			action: ({ formula, rendered }: { formula: string; rendered: string }) => {
				const checked = formulaChecked(formula);
				if (!checked.accepted) return actionNotOK(`the formula is refused: ${checked.reason}; ${checked.remedy}`);
				return checked.rendered === rendered ? actionOK() : actionNotOK(`the formula renders as "${checked.rendered}"`);
			},
		},
	} as const satisfies TStepperSteps;
}
