/**
 * Reads of a proof and of the predicate registry for the logic stepper's steps: a statement's derivation from the records its
 * proof wrote, a line's term and the line it renders as, the term of a call a transport carries, the rule a formula states
 * and the refusal of a formula outside the fragment or the registry, and the refusal of steppers from whose declarations the
 * registry doesn't derive each step once.
 */
import type { DispatchContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { nextSeqPath, proveStep } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { Resolver } from "@haibun/core/lib/actuality/pipelines/resolver.js";
import { readEvery, equalTo } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { runRegistry } from "@haibun/core/lib/steps/pipelines/step-registry.js";
import { mapInputToStepValues } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD, calledParts, executionOf, formatRecordName } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { constructorName } from "@haibun/core/lib/domains/util.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";
import type { AStepper, TFeatureStep } from "@haibun/core/lib/steps/domains/stepper.js";
import { derivationOf } from "../derivations/derivation.js";
import { lineOfTerm, registryPredicates, termOfAction, termText } from "../derivations/registry.js";
import type { TDerivation, TRule } from "../domains/logic.js";
import { checkFormula, unicodeOf } from "../derivations/formula.js";
import { declarationFindings } from "../derivations/declarations.js";

/** Whether a record's call is of a step the engine proves by its reading, and so a node of a proof. */
const isNodeOf =
	(steppers: AStepper[]) =>
	(called: string | undefined): boolean => {
		if (called === undefined) return false;
		const { stepperName, actionName } = calledParts(called);
		return steppers.find((one) => constructorName(one) === stepperName)?.steps[actionName]?.reading !== undefined;
	};

/** Proves a statement under a step, and returns its derivation from the records its proof wrote. */
export async function derivationUnder(ctx: DispatchContext, parent: TFeatureStep, statement: TFeatureStep): Promise<TDerivation> {
	const { world, steppers } = ctx;
	const seqPath = nextSeqPath(world, parent.seqPath);
	await proveStep(ctx, { ...statement, seqPath, isSubStep: true, ...(parent.runtimeArgs === undefined ? {} : { runtimeArgs: parent.runtimeArgs }) });
	const execution = executionOf(world.tag);
	const records = await readEvery(world.shared.getStore(), { label: SEQ_PATH_LABEL, filters: equalTo({ [SEQ_PATH_FIELD.execution]: execution }) });
	return derivationOf(records, formatRecordName({ execution, path: seqPath }), isNodeOf(steppers));
}

/** A line's term through the step it resolves to, as text, and the line the term renders as. */
export function lineTerm(world: TWorld, steppers: AStepper[], line: string): { term: string; rendered: string } {
	const action = new Resolver(steppers, []).findSingleStepAction(line);
	const { gwta } = action.step;
	if (gwta === undefined) throw new Error(`"${line}" resolves to ${action.stepperName}.${action.actionName}, whose pattern doesn't state placeholders to render`);
	const term = termOfAction(action, gwta, world.domains);
	return { term: termText(term), rendered: lineOfTerm(gwta, term, world.domains) };
}

/** The term of a call a transport carries: a method with its named parameters, as text. */
export function callTerm(world: TWorld, method: string, input: Record<string, unknown>): string {
	const { descriptor } = runRegistry(world).named(method);
	const action = { stepperName: descriptor.stepperName, actionName: descriptor.stepName, stepValuesMap: mapInputToStepValues(input, descriptor.pattern) };
	return termText(termOfAction(action, descriptor.pattern, world.domains));
}

/** The rule a formula states, or why the fragment or the registry doesn't hold the formula and what to write in its place. */
export function ruleOf(text: string, steppers: readonly AStepper[]): TRule | { refused: string } {
	const checked = checkFormula(text, registryPredicates(steppers, constructorName));
	if (!("annotated" in checked)) return { refused: `the formula is refused: ${checked.reason}; ${checked.remedy}` };
	const { name, role, formula } = checked.annotated;
	return { name, role, rendered: unicodeOf(formula) };
}

/** Why a formula a line writes isn't held, with its remedy, or undefined where the fragment and the registry hold it. */
export function formulaRefusal(text: string, steppers: readonly AStepper[]): string | undefined {
	const rule = ruleOf(text, steppers);
	return "refused" in rule ? rule.refused : undefined;
}

/** Refuses steppers whose declarations miss a face, repeat a pattern, or state a pattern whose own line parses two ways. */
export function refuseDeclarations(steppers: AStepper[]): void {
	const resolver = new Resolver(steppers, []);
	const findings = declarationFindings(steppers, constructorName, (line) => resolver.parsedStepAction(line));
	if (findings.length > 0) {
		const listed = findings.map(({ method, finding }) => `${method} ${finding}`).join("; ");
		throw new Error(
			`the steppers don't declare each step once with every face: ${listed}. Give each step a pattern and an action or a reading, and a pattern that only it parses, or a precludes that names the other step`,
		);
	}
}
