/**
 * A call of a step from its form, as a machine: ready before a call, refused at its input where the form's values don't
 * satisfy the step's input schema, calling, returned with what the step returned, or failed with its refusal. A call
 * starts from any state but calling, and a refused input ends any state but calling.
 */
import type { TPageRefusal } from "../domains/refusal.js";

export const STEP_CALL_STATUS = { READY: "ready", INVALID: "invalid", CALLING: "calling", RETURNED: "returned", FAILED: "failed" } as const;

/** The form's values refused, with each field's cause by its name. */
export type TStepCallState =
	| { status: typeof STEP_CALL_STATUS.READY }
	| { status: typeof STEP_CALL_STATUS.INVALID; refusal: TPageRefusal; fieldErrors: Record<string, string> }
	| { status: typeof STEP_CALL_STATUS.CALLING }
	| { status: typeof STEP_CALL_STATUS.RETURNED; result: unknown }
	| { status: typeof STEP_CALL_STATUS.FAILED; refusal: TPageRefusal };

export const STEP_CALL_EVENT = { REFUSE_INPUT: "refuse-input", CALL: "call", RETURN: "return", FAIL: "fail" } as const;

export type TStepCallEvent =
	| { type: typeof STEP_CALL_EVENT.REFUSE_INPUT; refusal: TPageRefusal; fieldErrors: Record<string, string> }
	| { type: typeof STEP_CALL_EVENT.CALL }
	| { type: typeof STEP_CALL_EVENT.RETURN; result: unknown }
	| { type: typeof STEP_CALL_EVENT.FAIL; refusal: TPageRefusal };

export const INITIAL_STEP_CALL = { status: STEP_CALL_STATUS.READY } as const satisfies TStepCallState;

/** Moves a call. A call under way ends only at its return or its failure, and a return or a failure of a call that isn't
 *  under way leaves the state as it is. */
export function stepCallTransition(state: TStepCallState, event: TStepCallEvent): TStepCallState {
	const calling = state.status === STEP_CALL_STATUS.CALLING;
	if (event.type === STEP_CALL_EVENT.CALL) return calling ? state : { status: STEP_CALL_STATUS.CALLING };
	if (event.type === STEP_CALL_EVENT.REFUSE_INPUT) return calling ? state : { status: STEP_CALL_STATUS.INVALID, refusal: event.refusal, fieldErrors: event.fieldErrors };
	if (!calling) return state;
	return event.type === STEP_CALL_EVENT.RETURN ? { status: STEP_CALL_STATUS.RETURNED, result: event.result } : { status: STEP_CALL_STATUS.FAILED, refusal: event.refusal };
}
