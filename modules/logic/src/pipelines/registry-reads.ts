/**
 * Reads of a proof and of the predicate registry for the logic stepper's steps: a statement's derivation from the records its
 * proof wrote, a line's term and the line it renders as, and the term of a call a transport carries.
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
import { lineOfTerm, termOfAction, termText } from "../derivations/registry.js";
import type { TDerivation } from "../domains/logic.js";

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
