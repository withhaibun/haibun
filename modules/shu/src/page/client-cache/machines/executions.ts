/**
 * The execution the page reads, as a machine: the one a reader chose, else the one the last window read. A reader's choice
 * switches the reading whenever it changes; the page observing another execution switches it only where it read a named
 * execution before, since a page reading its first execution hasn't switched from another.
 */
export type TExecutionsState = { chosen?: string; observed?: string; switches: number };

export const EXECUTIONS_EVENT = { CHOOSE: "choose", OBSERVE: "observe" } as const;

export type TExecutionsEvent = { type: typeof EXECUTIONS_EVENT.CHOOSE; execution: string | undefined } | { type: typeof EXECUTIONS_EVENT.OBSERVE; execution: string };

export const INITIAL_EXECUTIONS: TExecutionsState = { switches: 0 };

/** Returns the execution the page reads: the one chosen, else the one observed. */
export const readingOf = (state: TExecutionsState): string | undefined => (state.chosen === undefined ? state.observed : state.chosen);

/** Moves the reading. A choice of the execution already chosen, and an observation of the execution already observed,
 *  leave the state as it is. */
export function executionsTransition(state: TExecutionsState, event: TExecutionsEvent): TExecutionsState {
	if (event.type === EXECUTIONS_EVENT.CHOOSE) {
		if (state.chosen === event.execution) return state;
		const { chosen, ...rest } = state;
		return { ...rest, ...(event.execution === undefined ? {} : { chosen: event.execution }), switches: state.switches + 1 };
	}
	if (state.observed === event.execution) return state;
	const was = readingOf(state);
	const next = { ...state, observed: event.execution };
	const switched = was !== undefined && readingOf(next) !== was;
	return switched ? { ...next, switches: state.switches + 1 } : next;
}
