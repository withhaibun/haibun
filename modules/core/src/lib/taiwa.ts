/**
 * taiwa: contract for a stepper that responds to ask, plus runtime discovery
 * via `StepperKinds.TAIWA`. A stepper qualifies when `kind === StepperKinds.TAIWA`
 * and `ask(prompt, opts?)` is defined.
 *
 * One schema at the boundary: AskOptionsSchema, the per-call options a caller may state. What a selectable target
 * IS, and what a streamed chunk carries, are declared where they are persisted and streamed: a second copy here
 * described the same wire in fewer fields and nothing parsed through it.
 */

import { z } from "zod";
import { AStepper, StepperKinds } from "./astepper.js";

export const AskOptionsSchema = z.object({
	kihan: z.string().optional(),
	system: z.string().optional(),
	budget: z.number().optional(),
	timeoutMs: z.number().optional(),
	/** Per-call ceiling on chained tool dispatches the router provider may run. Router providers honour it; others ignore. Range 0-99. */
	maxToolCalls: z.number().int().min(0).max(99).optional(),
});
export type TAskOptions = z.infer<typeof AskOptionsSchema> & {
	signal?: AbortSignal;
};

export interface ITaiwa {
	ask(prompt: string, opts?: TAskOptions): Promise<string>;
	/**
	 * True iff the currently-active provider/model runs without leaving the host
	 * the local-provider allow-list. The autonomic loop and any other callers
	 * that gate private content on locality consult this; it MUST be implemented.
	 */
	isLocal(): boolean;
}

/**
 * Return the single taiwa-bridge among `steppers`, or undefined if none.
 * Throws when more than one taiwa stepper is loaded (ambiguity must be
 * resolved explicitly) or when the TAIWA-kinded stepper doesn't fully
 * implement the contract: every required method is verified up front so
 * downstream callers don't have to defend against missing methods.
 */
export function findTaiwa(steppers: AStepper[]): ITaiwa | undefined {
	const matches = steppers.filter((s) => s.kind === StepperKinds.TAIWA);
	if (matches.length === 0) return undefined;
	if (matches.length > 1) {
		const names = matches.map((s) => s.constructor.name).join(", ");
		throw new Error(`Multiple taiwa steppers loaded (${names}); deployments must pick one.`);
	}
	const candidate = matches[0] as unknown as Partial<ITaiwa>;
	const name = matches[0].constructor.name;
	if (typeof candidate.ask !== "function" || candidate.ask.length < 1) {
		throw new Error(`${name} declares kind=${StepperKinds.TAIWA} but does not implement ask(prompt, opts?).`);
	}
	if (typeof candidate.isLocal !== "function") {
		throw new Error(`${name} declares kind=${StepperKinds.TAIWA} but does not implement isLocal(): boolean.`);
	}
	return candidate as ITaiwa;
}
