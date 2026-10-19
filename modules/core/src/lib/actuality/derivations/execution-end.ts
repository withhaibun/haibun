/**
 * How a feature and an execution end: whether actuality stays after its features end, whether a feature's resources
 * close, the step that fails an execution, and the digest of the steps a feature declares.
 */
import { createHash } from "node:crypto";
import { STAY_ALWAYS, STAY_FAILURE, type TExecutorResult, type TFeatureResult } from "../../domains/protocol.js";
import type { TFeatureStep } from "../../steps/domains/stepper.js";

/** Returns whether actuality keeps serving after its features end. `HAIBUN_STAY` selects always or only after a failure. */
export function staysAfterExecution(stay: unknown, ok: boolean): boolean {
	return stay === STAY_ALWAYS || (stay === STAY_FAILURE && !ok);
}

/** Returns whether steppers close a feature's resources when the feature ends. They close them unless the feature is the last to execute and actuality stays. */
export function calculateShouldClose({ thisFeatureOK, isLast, continueAfterError, stay }: { thisFeatureOK: boolean; isLast: boolean; continueAfterError: boolean; stay: unknown }) {
	const effectivelyLast = isLast || (!thisFeatureOK && !continueAfterError);
	return !effectivelyLast || !staysAfterExecution(stay, thisFeatureOK);
}

/**
 * The failure an execution reports: the feature step that failed the first failed feature. foldStep stores the first
 * failed feature step in `steps.failed` in place of an earlier failed synthetic dispatch or nested call. A synthetic
 * dispatch has a negative seqPath segment. A model's tool call and an RPC dispatch are synthetic dispatches. The parent
 * step can recover from a failed synthetic dispatch, so naming the dispatch would report a recovered tool call as
 * actuality's failure. Undefined where every feature passed.
 */
export function executionFailure(featureResults: readonly TFeatureResult[]): TExecutorResult["failure"] | undefined {
	const failedStep = featureResults.find((fr) => !fr.ok)?.steps.failed;
	if (!failedStep) return undefined;
	if (failedStep.errorMessage === undefined) throw new Error(`the step "${failedStep.in}" failed without a message; its action returns actionNotOK with the reason it failed`);
	return { stage: "Execute", error: { message: failedStep.errorMessage, details: { step: failedStep.in, path: failedStep.path, seqPath: failedStep.seqPath } } };
}

/** Joins a feature's declared step lines with newlines in declaration order and returns their SHA-256 hex digest. */
export function declaredStepTextHash(featureSteps: readonly TFeatureStep[]): string {
	return createHash("sha256")
		.update(featureSteps.map((step) => step.in).join("\n"))
		.digest("hex");
}
