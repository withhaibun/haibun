/**
 * A read a view shows (`domains/load.ts`), as a machine. A read again starts the machine again from any state.
 */
import { LOAD_EVENT, LOAD_STATUS, type TLoadEvent, type TLoadState } from "../domains/load.js";

/** Moves a read: a start runs it from any state, and a completion or a failure ends a running read. A completion or a
 *  failure of a read that isn't running leaves the state as it is, as a read a later start replaced ends. */
export function loadTransition<T>(state: TLoadState<T>, event: TLoadEvent<T>): TLoadState<T> {
	if (event.type === LOAD_EVENT.START) return state.status === LOAD_STATUS.RUNNING ? state : { status: LOAD_STATUS.RUNNING };
	if (state.status !== LOAD_STATUS.RUNNING) return state;
	return event.type === LOAD_EVENT.COMPLETE ? { status: LOAD_STATUS.COMPLETED, page: event.page } : { status: LOAD_STATUS.FAILED, refusal: event.refusal };
}
