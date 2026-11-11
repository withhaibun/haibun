/**
 * The gate of a call: it refuses a call whose caller doesn't hold the action a step requires, or doesn't hold a read at the
 * step's level. A refusal of a lacked action carries the request of that action as its remedy.
 */
import { withinAccess, type AccessLevel } from "../../domains/resources.js";
import { actionsOf } from "../../domains/actions.js";
import { mayRun, type TCallContext } from "../../domains/capability-context.js";
import { RefusedCall, type TRemedy, type TRpcRefusal } from "../../transport/domains/rpc-wire.js";
import type { TStepDescriptor } from "../domains/step-discovery.js";

/** The remedy of a refusal that names the action a step requires: the caller requests that action from a key that holds it. */
const requestOf = (action: string): TRemedy => ({ do: "request", action });

/** A refusal that names the action the step requires. A caller can request that action from a holder. */
const namedRefusal = (method: string, required: string): TRpcRefusal => ({ error: `${method}: capability ${required} required`, remedy: requestOf(required) });

/** The refusal of a dispatched step that names the action the step requires and the actions the caller holds, which the
 *  step's record states. */
function heldRefusal(method: string, required: string, held: string[]): TRpcRefusal {
	const named = namedRefusal(method, required);
	return { ...named, error: `${named.error}, and the caller holds ${held.length === 0 ? "an empty list of actions" : held.join(", ")}` };
}

/** Refuses a call that its caller may not make, as `mayRun` determines. A call is also refused where the read in force is
 *  narrower than the step's `readsAt` level. A refusal of a lacked action carries the request of that action as its remedy. */
export function authorizeToolCapability(step: Pick<TStepDescriptor, "method" | "capability" | "readsAt">, call: TCallContext | undefined, readsIn: AccessLevel | undefined): void {
	const lacked = mayRun(call, step);
	if (lacked) throw new RefusedCall(heldRefusal(step.method, lacked, actionsOf(call?.held)));
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
