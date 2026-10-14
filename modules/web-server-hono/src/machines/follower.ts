/**
 * A follower of the event stream, as the stream's writer counts it. Each event sent to the follower is a write in flight
 * until the follower reads it. A follower that stops reading holds every event sent since, so a follower past a named
 * count of writes in flight is ended: it connects again and reads the graph for what it missed. A follower that reads
 * late, within the count, is kept.
 */
/** A follower as the stream's writer counts it: each write sent, and each write the follower read. `sent` states whether
 *  the follower is kept, or the reason it ends. */
export type TFollower = { sent(): { kept: true } | { kept: false; reason: string }; written(): void };

/** How many writes may be in flight to one follower before the stream ends it. */
export const FOLLOWER_WRITES_IN_FLIGHT = 1024;

/** A follower's writes in flight, and the reason it ended where it did. */
export type TFollowerState = { inFlight: number; ended?: string };

/** A follower that just connected. */
export const connected = (): TFollowerState => ({ inFlight: 0 });

/** A write sent to a follower: one more in flight, or the follower's end where the write would pass `limit`. An ended
 *  follower stays ended. */
export function sentTo(state: TFollowerState, limit: number): TFollowerState {
	if (state.ended !== undefined) return state;
	if (state.inFlight >= limit) return { ...state, ended: `the follower held ${state.inFlight} writes it didn't read, and a follower holds at most ${limit}` };
	return { inFlight: state.inFlight + 1 };
}

/** A write the follower read: one fewer in flight. */
export function readBy(state: TFollowerState): TFollowerState {
	if (state.inFlight === 0) throw new Error("a follower read a write that wasn't in flight; count each write as sent before it is written");
	return { ...state, inFlight: state.inFlight - 1 };
}

/** A follower the stream's writer counts, kept while its writes in flight stay within `limit`. */
export function follower(limit: number): TFollower {
	let state = connected();
	return {
		sent: () => {
			state = sentTo(state, limit);
			return state.ended === undefined ? { kept: true } : { kept: false, reason: state.ended };
		},
		written: () => {
			state = readBy(state);
		},
	};
}
