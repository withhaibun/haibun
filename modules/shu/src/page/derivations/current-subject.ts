/**
 * The reads of the current-subject state: the scope and the entry the reader activated most recently, the record every
 * view dims around, and a scope's own entry.
 */
import type { TEntry, TRecord } from "../domains/current-subject.js";
import type { TScopeState, TSubjectState } from "../machines/current-subject.js";

/** The open scope activated most recently, with what it holds, or null where the open scopes don't have an entry. */
function newestOpen(state: TSubjectState): { scope: string; held: TScopeState } | null {
	let newest: { scope: string; held: TScopeState } | null = null;
	for (const scope of state.open) {
		const held = state.scopes[scope];
		if (held && (newest === null || held.stamp > newest.held.stamp)) newest = { scope, held };
	}
	return newest;
}

/** The open scope activated most recently, or null where the open scopes don't have an entry. */
export function activeScope(state: TSubjectState): string | null {
	const newest = newestOpen(state);
	return newest === null ? null : newest.scope;
}

/** The active entry: the entry of the open scope activated most recently. */
export function activeEntry(state: TSubjectState): TEntry | null {
	const newest = newestOpen(state);
	return newest === null ? null : newest.held.entry;
}

/** The record every view dims around and a following graph centres. */
export function currentSubject(state: TSubjectState): TRecord | null {
	return activeEntry(state)?.record ?? null;
}

/** A scope's own entry, open or not. */
export function scopeEntry(state: TSubjectState, scope: string): TEntry | null {
	return state.scopes[scope]?.entry ?? null;
}
