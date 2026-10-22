/**
 * The actuality feature the page reads, as a machine: the one a reader chose, else the one the last window read. A reader's choice
 * switches the reading whenever it changes; the page observing another actuality feature switches it only where it read a named
 * actuality feature before, since a page reading its first actuality feature hasn't switched from another.
 */
export type TActualityFeaturesState = { chosen?: string; observed?: string; switches: number };

export const ACTUALITY_FEATURES_EVENT = { CHOOSE: "choose", OBSERVE: "observe" } as const;

export type TActualityFeaturesEvent =
	| { type: typeof ACTUALITY_FEATURES_EVENT.CHOOSE; actuality: string | undefined }
	| { type: typeof ACTUALITY_FEATURES_EVENT.OBSERVE; actuality: string };

export const INITIAL_ACTUALITY_FEATURES: TActualityFeaturesState = { switches: 0 };

/** Returns the actuality feature the page reads: the one chosen, else the one observed. */
export const readingOf = (state: TActualityFeaturesState): string | undefined => (state.chosen === undefined ? state.observed : state.chosen);

/** Moves the reading. A choice of the actuality feature already chosen, and an observation of the actuality feature already observed,
 *  leave the state as it is. */
export function actualityFeaturesTransition(state: TActualityFeaturesState, event: TActualityFeaturesEvent): TActualityFeaturesState {
	if (event.type === ACTUALITY_FEATURES_EVENT.CHOOSE) {
		if (state.chosen === event.actuality) return state;
		const { chosen, ...rest } = state;
		return { ...rest, ...(event.actuality === undefined ? {} : { chosen: event.actuality }), switches: state.switches + 1 };
	}
	if (state.observed === event.actuality) return state;
	const was = readingOf(state);
	const next = { ...state, observed: event.actuality };
	const switched = was !== undefined && readingOf(next) !== was;
	return switched ? { ...next, switches: state.switches + 1 } : next;
}
