/**
 * taiwa: the contract for a stepper that implements `ask`, and its runtime discovery
 * through `StepperKinds.TAIWA`. A stepper qualifies when `kind === StepperKinds.TAIWA`
 * and it implements `ask(prompt, opts?)` and `isLocal()`.
 *
 * AskOptionsSchema is the one schema at this boundary. It holds the per-call options a caller may state. A selectable
 * target and a streamed chunk are declared where they are persisted and streamed, so this module doesn't copy them.
 */

import { z } from "zod";
import { AStepper, StepperKinds } from "../steps/domains/stepper.js";

const AskOptionsSchema = z.object({
	/** The model a call is sent to, where it isn't the standing default. */
	model: z.string().optional(),
	system: z.string().optional(),
	limit: z.number().optional(),
	timeoutMs: z.number().optional(),
	/** The per-call maximum of chained tool dispatches a router provider may run. Router providers apply it, and other providers ignore it. Range 0-99. */
	maxToolCalls: z.number().int().min(0).max(99).optional(),
});
export type TAskOptions = z.infer<typeof AskOptionsSchema> & { signal?: AbortSignal };

export interface ITaiwa {
	ask(prompt: string, opts?: TAskOptions): Promise<string>;
	/**
	 * True where the local-provider allow-list names the active provider, so content sent to it stays on the host. A caller
	 * that gates private content on locality reads this. findTaiwa throws for a taiwa stepper without it.
	 */
	isLocal(): boolean;
}

/**
 * Return the one taiwa-bridge among `steppers`, or undefined if one isn't loaded.
 * Throws when more than one taiwa stepper is loaded, since a deployment must pick one.
 * Also throws when the TAIWA-kinded stepper doesn't implement every method of the
 * contract. The check runs at discovery, so a caller doesn't check for a missing method.
 */
export function findTaiwa(steppers: AStepper[]): ITaiwa | undefined {
	const matches = steppers.filter((s) => s.kind === StepperKinds.TAIWA);
	const [match, ...others] = matches;
	if (!match) return undefined;
	if (others.length > 0) {
		const names = matches.map((s) => s.constructor.name).join(", ");
		throw new Error(`Multiple taiwa steppers loaded (${names}); deployments must pick one.`);
	}
	assertTaiwa(match);
	return match;
}

/** Throws unless a stepper of the TAIWA kind implements the contract. The error names the method the stepper doesn't implement. */
function assertTaiwa(stepper: AStepper): asserts stepper is AStepper & ITaiwa {
	const name = stepper.constructor.name;
	if (!("ask" in stepper) || typeof stepper.ask !== "function" || stepper.ask.length < 1) {
		throw new Error(`${name} declares kind=${StepperKinds.TAIWA} but does not implement ask(prompt, opts?).`);
	}
	if (!("isLocal" in stepper) || typeof stepper.isLocal !== "function") {
		throw new Error(`${name} declares kind=${StepperKinds.TAIWA} but does not implement isLocal(): boolean.`);
	}
}
