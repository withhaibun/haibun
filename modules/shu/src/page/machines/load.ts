/**
 * A read a view shows, as a machine: pending before it starts, running, completed with what it read, or failed with its
 * refusal. A read again starts the machine again from any state.
 */
import type { TPageRefusal } from "../domains/refusal.js";

export const LOAD_STATUS = { PENDING: "pending", RUNNING: "running", COMPLETED: "completed", FAILED: "failed" } as const;

export type TLoadState<T> =
	| { status: typeof LOAD_STATUS.PENDING }
	| { status: typeof LOAD_STATUS.RUNNING }
	| { status: typeof LOAD_STATUS.COMPLETED; page: T }
	| { status: typeof LOAD_STATUS.FAILED; refusal: TPageRefusal };

export const LOAD_EVENT = { START: "start", COMPLETE: "complete", FAIL: "fail" } as const;

export type TLoadEvent<T> = { type: typeof LOAD_EVENT.START } | { type: typeof LOAD_EVENT.COMPLETE; page: T } | { type: typeof LOAD_EVENT.FAIL; refusal: TPageRefusal };

export const INITIAL_LOAD = { status: LOAD_STATUS.PENDING } as const satisfies TLoadState<never>;

/** Moves a read: a start runs it from any state, and a completion or a failure ends a running read. A completion or a
 *  failure of a read that isn't running leaves the state as it is, as a read a later start replaced ends. */
export function loadTransition<T>(state: TLoadState<T>, event: TLoadEvent<T>): TLoadState<T> {
	if (event.type === LOAD_EVENT.START) return state.status === LOAD_STATUS.RUNNING ? state : { status: LOAD_STATUS.RUNNING };
	if (state.status !== LOAD_STATUS.RUNNING) return state;
	return event.type === LOAD_EVENT.COMPLETE ? { status: LOAD_STATUS.COMPLETED, page: event.page } : { status: LOAD_STATUS.FAILED, refusal: event.refusal };
}
