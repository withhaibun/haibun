import { AStepper, type TStepAction } from "../steps/domains/stepper.js";
import type { TFeatures } from "../actuality/domains/actuality.js";
import { Resolver, TermRefused, type TRefusedTerm } from "../actuality/pipelines/resolver.js";
import { errorDetail } from "../domains/util.js";
import { mayCall, requiredAction } from "../domains/actions.js";

/**
 * Result of validating a line against registered steppers.
 */
type StepValidationResult = { valid: true; action: TStepAction } | { valid: false; error: string; refused?: TRefusedTerm };

/**
 * Validate a line against the steps of the registered steppers that a caller holding `held` may call, so a line
 * that names a step the caller doesn't hold is treated as one that doesn't name a step. Returns the matched action if valid, or
 * an error message if not.
 */
export function validateStep(text: string, steppers: AStepper[], held: string | string[] | undefined, backgrounds?: TFeatures): StepValidationResult {
	const resolver = new Resolver(steppers, backgrounds || [], (stepperName, actionName, step) => mayCall(held, { capability: requiredAction(stepperName, actionName, step) }));
	try {
		const action = resolver.findSingleStepAction(text);
		return { valid: true, action };
	} catch (e) {
		return e instanceof TermRefused ? { valid: false, error: e.message, refused: e.refused } : { valid: false, error: errorDetail(e) };
	}
}
