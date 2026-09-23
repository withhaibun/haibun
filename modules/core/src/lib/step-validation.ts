import { AStepper, type TStepAction } from "./astepper.js";
import type { TFeatures } from "./execution.js";
import { Resolver } from "../phases/Resolver.js";
import { errorDetail } from "./util/index.js";
import { capabilityAllows, requiredAction } from "./actions.js";

/**
 * Result of validating a step text against registered steppers.
 */
export type StepValidationResult =
	| {
			valid: true;
			action: TStepAction;
	  }
	| {
			valid: false;
			error: string;
	  };

/**
 * Validate a step text against the steps of the registered steppers that a caller holding `held` may call, so a line
 * that names a step the caller doesn't hold is answered as one naming no step. Returns the matched action if valid, or
 * an error message if not.
 */
export function validateStep(text: string, steppers: AStepper[], held: string | string[] | undefined, backgrounds?: TFeatures): StepValidationResult {
	const resolver = new Resolver(steppers, backgrounds || [], (stepperName, actionName, step) => capabilityAllows(held, requiredAction(stepperName, actionName, step)));
	try {
		const action = resolver.findSingleStepAction(text);
		return { valid: true, action };
	} catch (e) {
		return { valid: false, error: errorDetail(e) };
	}
}
