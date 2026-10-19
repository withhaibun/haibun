/**
 * A step's result, and its feature's step totals: the result a step's action and its cycles determine, the products its
 * events and facts retain, and the totals that grow with each finished step.
 */
import { ownFailure, type TActionResult, type TFeatureSteps, type TStepResult } from "../../domains/protocol.js";
import type { TAfterStepResult, TFeatureStep, TStepAction } from "../../steps/domains/stepper.js";

/** The number of a feature's most recent finished steps whose results a reader can read in full. foldStep reduces every
 *  step into the feature's step totals, and the totals don't hold the steps. */
export const RESULTS_READ_IN_FULL = 1000;

/** The products kept on a step's lifecycle event: every product where the step doesn't state a retention or retains
 *  them, an absent set for `false`, else the subset the filter returns. */
export function retainedProducts(
	products: Record<string, unknown> | undefined,
	retain: boolean | ((p: Record<string, unknown>) => Record<string, unknown> | undefined) | undefined,
): Record<string, unknown> | undefined {
	if (retain === undefined || retain === true) return products;
	if (retain === false || products === undefined) return undefined;
	return retain(products);
}

/** Adds one finished step to its feature's step totals: the count, the first start, the last end and the failure. */
export function foldStep(steps: TFeatureSteps, result: TStepResult): void {
	steps.count += 1;
	if (result.start !== undefined && (steps.firstStart === undefined || result.start < steps.firstStart)) steps.firstStart = result.start;
	if (result.end !== undefined && (steps.lastEnd === undefined || result.end > steps.lastEnd)) steps.lastEnd = result.end;
	if (result.ok) return;
	if (steps.failed === undefined || (ownFailure(result) && !ownFailure(steps.failed))) steps.failed = result;
}

/** Returns a step's result after the afterStep cycles. A cycle that fails a passing step states a reason, and the step
 *  fails with that reason. A step that failed keeps its own reason. A cycle that returns `nextStep` passes the step. */
export function afterStepOutcome(result: TActionResult, instructions: Array<TAfterStepResult | undefined>): TActionResult {
	const failure = instructions.find((i) => i?.failed)?.failed;
	const { products, controlSignal, artifact } = result;
	if (failure) return result.ok ? { products, controlSignal, artifact, ok: false, errorMessage: failure } : result;
	if (instructions.some((i) => i?.nextStep)) return { products, controlSignal, artifact, ok: true };
	return result;
}

/** A step's result from its action's result, with the step's line, where it is stated, its path, whether it is nested in a
 *  line's proof, and when it began and ended. */
export function stepResultOf(actionResult: TActionResult, action: TStepAction, start: number, end: number, featureStep: TFeatureStep): TStepResult {
	return {
		...actionResult,
		name: action.actionName,
		in: featureStep.in,
		path: featureStep.source?.path,
		lineNumber: featureStep.source?.lineNumber,
		seqPath: featureStep.seqPath,
		...(featureStep.isSubStep === true ? { isSubStep: true } : {}),
		start,
		end,
	};
}
