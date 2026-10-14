/**
 * The method that names a step: its stepper's name, a hyphen and its step's name. A step another host registers is named
 * with that host's prefix. Every transport, every caller and the registry key a step by this one method.
 */
import type { AStepper } from "./stepper.js";
import { constructorName } from "../../util/index.js";

const HOST_SCOPE = /^host(\d+)_/;

/** The method of a step. Takes a stepper, a stepper class or a stepper's name. */
export function stepMethodName(stepperOrName: string | AStepper | { name: string }, stepName: string): string {
	const name = typeof stepperOrName === "string" ? stepperOrName : "steps" in stepperOrName ? constructorName(stepperOrName) : stepperOrName.name;
	return `${name}-${stepName}`;
}

/** The host id a method names, or undefined for a step of this process. */
export function hostOfMethodName(name: string): number | undefined {
	const at = name.match(HOST_SCOPE);
	return at ? Number(at[1]) : undefined;
}

/** A host-scoped method without its host prefix. Its own host registers the step under this name, and a caller of that host
 *  writes this name. */
export function bareMethodName(name: string): string {
	return name.replace(HOST_SCOPE, "");
}

/**
 * The method of a step that another host registers: `host{hostId}_{method}`. A caller also uses the method as the step's
 * tool name. A model's tool name holds only letters, digits, underscores and hyphens, so the prefix uses only those
 * characters. The `host` prefix keeps the method from beginning with a digit.
 */
export function hostScopedMethodName(hostId: number, bareMethod: string): string {
	return `host${hostId}_${bareMethod}`;
}
