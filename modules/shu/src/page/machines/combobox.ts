/**
 * A combobox's list, as a machine: closed, or open with the text that filters its options and the option the keys focus.
 * An offer opens the list on every option, a typed text filters it, a key moves the focus within the options it offers,
 * and a pick or a close closes it.
 */
export const COMBO_STATUS = { CLOSED: "closed", OPEN: "open" } as const;

/** The focus of a list that the keys haven't moved. */
export const UNFOCUSED = -1;

export type TComboState = { status: typeof COMBO_STATUS.CLOSED } | { status: typeof COMBO_STATUS.OPEN; filter: string; focus: number };

export const COMBO_EVENT = { OFFER: "offer", FILTER: "filter", MOVE: "move", CLOSE: "close" } as const;

/** A move of the focus by `by` options, within the `offered` options the list shows. */
export type TComboEvent =
	| { type: typeof COMBO_EVENT.OFFER }
	| { type: typeof COMBO_EVENT.FILTER; text: string }
	| { type: typeof COMBO_EVENT.MOVE; by: 1 | -1; offered: number }
	| { type: typeof COMBO_EVENT.CLOSE };

export const INITIAL_COMBO = { status: COMBO_STATUS.CLOSED } as const satisfies TComboState;

/** Moves a combobox's list. An offer of an open list keeps it as it is, and a move of a closed list leaves it closed. */
export function comboTransition(state: TComboState, event: TComboEvent): TComboState {
	if (event.type === COMBO_EVENT.CLOSE) return INITIAL_COMBO;
	if (event.type === COMBO_EVENT.OFFER) return state.status === COMBO_STATUS.OPEN ? state : { status: COMBO_STATUS.OPEN, filter: "", focus: UNFOCUSED };
	if (event.type === COMBO_EVENT.FILTER) return { status: COMBO_STATUS.OPEN, filter: event.text, focus: UNFOCUSED };
	if (state.status !== COMBO_STATUS.OPEN || event.offered === 0) return state;
	const focus = state.focus === UNFOCUSED && event.by === -1 ? 0 : Math.min(Math.max(state.focus + event.by, 0), event.offered - 1);
	return { ...state, focus };
}
