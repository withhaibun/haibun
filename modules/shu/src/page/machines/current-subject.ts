/**
 * The active record on the page, tracked in one place.
 *
 * A scope is a named part of the page that activates records: the panes activate records in the `page` scope, and the
 * actions bar's conversation activates its comments in the `actions-bar` scope. Each scope keeps its latest entry: a
 * record, the conversation turn it is part of where it is one, and the bundle that goes with it. A scope is open or
 * closed, and the active entry is the entry of the open scope activated most recently. Closing a scope returns to the entry of the scope
 * activated before it, and opening it again returns to its own entry unless another scope was activated since.
 *
 * Only these events change the state, and each is a reader's act or a record of the reader's own turn. Anything else
 * that happens on the page (a data arrival, the actuality being read moving on, a replay, a pane opened by a trace, a resize,
 * a layout coming to rest) is not an event here, so it cannot move the active record. The graph's follow and highlight,
 * the ask and the context status each read an output of the state rather than holding a piece of it.
 */
import { SCOPE, type TEntry } from "../domains/current-subject.js";

export type TScopeState = { entry: TEntry; stamp: number };

export type TSubjectState = {
	scopes: Record<string, TScopeState>;
	/** The scopes that are open, in the order they were opened. */
	open: string[];
	/** The stamp the next activation takes. */
	clock: number;
};

export type TSubjectEvent =
	| { type: "activate"; scope: string; entry: TEntry }
	| { type: "update"; scope: string; entry: TEntry }
	| { type: "clear"; scope: string }
	| { type: "open"; scope: string }
	| { type: "close"; scope: string };
type TSubjectEventType = TSubjectEvent["type"];
export const SUBJECT_EVENTS = ["activate", "update", "clear", "open", "close"] as const satisfies readonly TSubjectEventType[];

export const INITIAL_SUBJECT: TSubjectState = { scopes: {}, open: [SCOPE.page], clock: 1 };

/** The next state, for any state and any event. `activate` stamps the scope's entry as the newest activation; `update`
 *  keeps the stamp it had, and a scope updated before it was ever activated is the oldest. `clear` removes the scope's
 *  entry and its stamp, so the scope doesn't lead until it activates again. */
export function transition(state: TSubjectState, event: TSubjectEvent): TSubjectState {
	switch (event.type) {
		case "activate":
			return { ...state, scopes: { ...state.scopes, [event.scope]: { entry: event.entry, stamp: state.clock } }, clock: state.clock + 1 };
		case "update":
			return { ...state, scopes: { ...state.scopes, [event.scope]: { entry: event.entry, stamp: state.scopes[event.scope]?.stamp ?? 0 } } };
		case "clear": {
			if (!state.scopes[event.scope]) return state;
			const { [event.scope]: _cleared, ...scopes } = state.scopes;
			return { ...state, scopes };
		}
		case "open":
			return state.open.includes(event.scope) ? state : { ...state, open: [...state.open, event.scope] };
		case "close":
			return state.open.includes(event.scope) ? { ...state, open: state.open.filter((scope) => scope !== event.scope) } : state;
	}
}
