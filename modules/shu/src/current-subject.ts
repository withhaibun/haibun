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
 * that happens on the page (a data arrival, the run being read moving on, a replay, a pane opened by a trace, a resize,
 * a layout coming to rest) is not an event here, so it cannot move the active record. The graph's follow and highlight,
 * the ask and the context status each read an output of the state rather than holding a piece of it.
 */
import { DENOTES } from "@haibun/core/lib/typed-links.js";
import type { TBundle, TContextPattern } from "./schemas.js";
import { SharedMachine } from "./signals.js";

/** A record: what a pane shows, or a comment of a conversation. */
export type TRecord = { id: string; label: string };

/** What a scope has active. An entry with no record is a scope whose reader chose nothing, or chose a type. */
export type TEntry = { record: TRecord | null; turn?: string; bundle: TBundle };

/** The scopes this page activates records in. */
export const SCOPE = { page: "page", actionsBar: "actions-bar" } as const;

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
export type TSubjectEventType = TSubjectEvent["type"];
export const SUBJECT_EVENTS = ["activate", "update", "clear", "open", "close"] as const satisfies readonly TSubjectEventType[];

export const INITIAL_SUBJECT: TSubjectState = { scopes: {}, open: [SCOPE.page], clock: 1 };

/** The entry for a set of context patterns: the record the first of them names, where it names one, with the patterns
 *  as its bundle. A type names no record. */
export function entryOf(patterns: TContextPattern[], accessLevel: string): TEntry {
	const first = patterns[0];
	const record = first && first.kind === DENOTES.individual ? { id: first.id, label: first.persistedAs } : null;
	return { record, bundle: { patterns, accessLevel } };
}

/** The next state, for any state and any event. `activate` stamps the scope's entry as the newest activation; `update`
 *  keeps the stamp it had, and a scope updated before it was ever activated is the oldest. `clear` removes the scope's
 *  entry and its stamp, so the scope leads nothing until it activates again. */
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

/** The open scope activated most recently, or null where no open scope has an entry. */
export function activeScope(state: TSubjectState): string | null {
	let newest: string | null = null;
	for (const scope of state.open) {
		const held = state.scopes[scope];
		if (held && (newest === null || held.stamp > state.scopes[newest].stamp)) newest = scope;
	}
	return newest;
}

/** The active entry: the entry of the open scope activated most recently. */
export function activeEntry(state: TSubjectState): TEntry | null {
	const scope = activeScope(state);
	return scope === null ? null : state.scopes[scope].entry;
}

/** The record every view dims around and a following graph centres. */
export function currentSubject(state: TSubjectState): TRecord | null {
	return activeEntry(state)?.record ?? null;
}

/** A scope's own entry, open or not. */
export function scopeEntry(state: TSubjectState, scope: string): TEntry | null {
	return state.scopes[scope]?.entry ?? null;
}

/** The one instance, shared across every component and bundle. */
const subjectMachine = new SharedMachine<TSubjectState, TSubjectEvent>("currentSubject", INITIAL_SUBJECT, transition);
export const currentSubjectState = subjectMachine.state;
export const dispatchSubjectEvent = (event: TSubjectEvent): TSubjectState => subjectMachine.dispatch(event);
