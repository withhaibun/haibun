/**
 * How current a reading of actuality is, as a machine: each announcement of a change it shows is numbered, a read that
 * begins has read for every announcement numbered so far once it settles, and the stream is up or cut off. A reading is
 * current, behind (an announcement it hasn't read for), or cut off (the stream is down, so a change isn't announced).
 * Numbers rather than clocks, so an announcement and a read in the same instant are still ordered.
 */
export const READING_STATUS = { CURRENT: "current", BEHIND: "behind", CUT_OFF: "cut-off" } as const;
export type TReadingStatus = (typeof READING_STATUS)[keyof typeof READING_STATUS];

export type TReadingState = { announced: number; settled: number; disconnected: boolean };

export const READING_EVENT = { ANNOUNCE: "announce", SETTLE: "settle", DISCONNECT: "disconnect", RECONNECT: "reconnect" } as const;

/** A settle states the announcements numbered when its read began. */
export type TReadingEvent =
	| { type: typeof READING_EVENT.ANNOUNCE }
	| { type: typeof READING_EVENT.SETTLE; readFor: number }
	| { type: typeof READING_EVENT.DISCONNECT }
	| { type: typeof READING_EVENT.RECONNECT };

export const INITIAL_READING: TReadingState = { announced: 0, settled: 0, disconnected: false };

/** Returns whether the reading is cut off, behind, or current. */
export const readingStatus = (state: TReadingState): TReadingStatus =>
	state.disconnected ? READING_STATUS.CUT_OFF : state.settled < state.announced ? READING_STATUS.BEHIND : READING_STATUS.CURRENT;

/** Moves a reading. A stream that comes back is an announcement: what actuality recorded while it was down didn't arrive. */
export function readingTransition(state: TReadingState, event: TReadingEvent): TReadingState {
	if (event.type === READING_EVENT.ANNOUNCE) return { ...state, announced: state.announced + 1 };
	if (event.type === READING_EVENT.SETTLE) return event.readFor > state.settled ? { ...state, settled: event.readFor } : state;
	if (event.type === READING_EVENT.DISCONNECT) return { ...state, disconnected: true };
	return { ...state, disconnected: false, announced: state.announced + 1 };
}
