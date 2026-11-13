/**
 * Derives the id a delegation's signer states: the id its record's keys derive from the fields a store holds of it, with the
 * actions it allows as `delegatedActions` reads them, so a delegation that doesn't list an action is keyed by every action, and
 * the nonce its proof states.
 */
import { CAPABILITY_KEYS, CAPABILITY_LABEL, delegatedActions, type TDelegation } from "../../domains/actions.js";
import { derivedId } from "./unit-parts.js";

/** What a delegation's id is derived from: the document it states. */
type TDelegated = TDelegation & { parentCapability: string; controller: string; invocationTarget: string; expires: string };

/** Returns the id of a delegation `delegator` signs with the proof nonce `nonce` from `parentCapability` to `controller` over
 *  `invocationTarget` until `expires`. */
export const delegationIdOf = (delegation: TDelegated, delegator: string, nonce: string): string =>
	derivedId(CAPABILITY_LABEL, CAPABILITY_KEYS, { ...delegation, delegator, nonce, allowedAction: delegatedActions(delegation) });
