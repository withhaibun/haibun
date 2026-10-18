/**
 * The gate of a call: it refuses a call whose caller doesn't hold the action a step requires, or doesn't hold a read at the
 * step's level. A refusal of a lacked action carries the request of that action as its remedy.
 */
import { withinAccess, type AccessLevel } from "../../domains/resources.js";
import { lackedByCall, type TCallAuthority } from "../../domains/actions.js";
import { RefusedCall, type TRemedy, type TRpcRefusal } from "../../transport/domains/rpc-wire.js";
import type { TStepDescriptor } from "../domains/step-discovery.js";

/** The remedy of a refusal that names the action a step requires: the caller requests that action from a key that holds it. */
const requestOf = (action: string): TRemedy => ({ do: "request", action });

/** A refusal that names the action the step requires. A caller can request that action from a holder. */
const namedRefusal = (method: string, required: string): TRpcRefusal => ({ error: `${method}: capability ${required} required`, remedy: requestOf(required) });

/** Refuses a call that its caller may not make. A call is refused where it didn't invoke the step's action, or where its
 *  caller doesn't hold a read at the step's `readsAt` level. A call is also refused where the read in force is narrower
 *  than the step's `readsAt` level. A refusal of a lacked action carries the request of that action as its remedy. */
export function authorizeToolCapability(step: Pick<TStepDescriptor, "method" | "capability" | "readsAt">, call: TCallAuthority, readsIn: AccessLevel | undefined): void {
	const lacked = lackedByCall(call, step);
	if (lacked) throw new RefusedCall(namedRefusal(step.method, lacked));
	if (step.readsAt && readsIn && !withinAccess(step.readsAt, readsIn)) throw new Error(`${step.method} reads at ${step.readsAt}, and this call reads at ${readsIn}`);
}

/**
 * The refusal that a caller from outside actuality receives. A caller that proved a key receives a refusal that names the
 * action the step requires, with the request of that action as its remedy, or a refusal that states that the step doesn't
 * exist. A caller that didn't prove a key receives only a statement that it may not make the call. That refusal is the
 * same whether the step exists or not, so it doesn't reveal which steps actuality registers.
 */
export function refusal(method: string, required: string | undefined, principal: string | undefined): TRpcRefusal {
	if (!principal) return { error: `${method}: not a call this caller may make` };
	return required ? namedRefusal(method, required) : { error: `${method}: actuality doesn't register a step of this method; show steps lists the methods it registers` };
}
