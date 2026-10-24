/**
 * The method that names a step: its stepper's name, a hyphen and its step's name. A step another host registers is named
 * with that host's prefix. Every transport, every caller and the registry key a step by this one method.
 */
import { z } from "zod";
import type { AStepper } from "./stepper.js";
import { constructorName } from "../../domains/util.js";

const HOST_SCOPE = /^host(\d+)_/;

/** The grammar of a method: a host's prefix where another host registers the step, its stepper's name, a hyphen and its step's name. */
const METHOD_GRAMMAR = /^(host\d+_)?[A-Za-z]\w*-\w+$/;

/** A step's method as a reader states it. A reference to a step takes one, so an action, a domain or a record's id isn't
 *  taken for a step. A method a link, a call or an input states is parsed with its grammar; one this module builds from a
 *  stepper's name and a step's name is stated in that grammar. A refusal states the grammar's pattern. */
export const StepMethodSchema = z.string().regex(METHOD_GRAMMAR).brand<"StepMethod">();
export type TStepMethod = z.infer<typeof StepMethodSchema>;

/** The method of a step. Takes a stepper, a stepper class or a stepper's name. */
export function stepMethodName(stepperOrName: string | AStepper | { name: string }, stepName: string): TStepMethod {
	const name = typeof stepperOrName === "string" ? stepperOrName : "steps" in stepperOrName ? constructorName(stepperOrName) : stepperOrName.name;
	return `${name}-${stepName}` as TStepMethod;
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
export function hostScopedMethodName(hostId: number, bareMethod: string): TStepMethod {
	return `host${hostId}_${bareMethod}` as TStepMethod;
}
