/**
 * Derives the id a delegation's signer states: the id its record's keys derive from the fields a store holds of it, with the
 * actions it allows as `delegatedActions` reads them, so a delegation that doesn't list an action is keyed by every action, and
 * the time its proof states it was signed.
 */
import { CAPABILITY_KEYS, CAPABILITY_LABEL, delegatedActions, type TDelegation } from "../../domains/actions.js";
import { derivedId } from "./unit-parts.js";

/** The milliseconds in a second. */
const MS_PER_SECOND = 1000;

/** What a delegation's id is derived from: the document it states. */
type TDelegated = TDelegation & { parentCapability: string; controller: string; invocationTarget: string; expires: string };

/** Returns the time a Data Integrity proof states it was created at `at`: to the second, as its `created` dateTime states it. */
export const signingTime = (at: Date): Date => new Date(Math.floor(at.getTime() / MS_PER_SECOND) * MS_PER_SECOND);

/** Returns the id of a delegation `delegator` signs at `signedAt` from `parentCapability` to `controller` over `invocationTarget`
 *  until `expires`. */
export const delegationIdOf = (delegation: TDelegated, delegator: string, signedAt: Date): string =>
	derivedId(CAPABILITY_LABEL, CAPABILITY_KEYS, { ...delegation, delegator, generatedAtTime: signedAt, allowedAction: delegatedActions(delegation) });
