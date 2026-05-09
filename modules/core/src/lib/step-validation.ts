import { AStepper, type TStepAction } from "./astepper.js";
import type { TFeatures } from "./execution.js";
import { Resolver } from "../phases/Resolver.js";
import { StepperRegistry, type StepDescriptor } from "./stepper-registry.js";
import { errorDetail } from "./util/index.js";

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
 * Validate a step text against the registered steppers.
 * Returns the matched action if valid, or an error message if not.
 *
 * Shared by LSP (diagnostics), SSE (step mode validation), and any future consumer.
 */
export function validateStep(text: string, steppers: AStepper[], backgrounds?: TFeatures): StepValidationResult {
	const resolver = new Resolver(steppers, backgrounds || []);
	try {
		const action = resolver.findSingleStepAction(text);
		return { valid: true, action };
	} catch (e) {
		return { valid: false, error: errorDetail(e) };
	}
}

/**
 * Get metadata for all exposed steps across all steppers.
 * Used for autocomplete in LSP, SSE step mode, and MCP tool discovery.
 */
export function getStepDescriptors(steppers: AStepper[]): StepDescriptor[] {
	return StepperRegistry.getMetadata(steppers);
}
