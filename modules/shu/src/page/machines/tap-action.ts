/**
 * The tap action machine: holds the action primed from the toolbar, or null when idle, and what the last copy did.
 */
import type { TTapAction } from "../../domains/elements.js";

/** What a copy did: the clipboard holds the text, the target didn't hold any, or the clipboard didn't take it. */
export const COPY_RESULT = { copied: "copied", empty: "empty", refused: "refused" } as const;
export type TCopyResult = (typeof COPY_RESULT)[keyof typeof COPY_RESULT];

export type TTapActionState = { primed: TTapAction | null; copied: TCopyResult | null };

export const TAP_ACTION_EVENT = { TOGGLE: "toggle", CLEAR: "clear", COPIED: "copied" } as const;

export type TTapActionEvent =
	| { type: typeof TAP_ACTION_EVENT.TOGGLE; action: TTapAction }
	| { type: typeof TAP_ACTION_EVENT.CLEAR }
	| { type: typeof TAP_ACTION_EVENT.COPIED; copied: TCopyResult };

export const INITIAL_TAP_ACTION: TTapActionState = { primed: null, copied: null };

/** A toggle primes its action, or clears it where it is primed, and clears the last copy's result. A clear keeps that result,
 *  since a press that copies clears the action before the clipboard responds. */
export function tapActionTransition(state: TTapActionState, event: TTapActionEvent): TTapActionState {
	if (event.type === TAP_ACTION_EVENT.CLEAR) return { ...state, primed: null };
	if (event.type === TAP_ACTION_EVENT.COPIED) return { ...state, copied: event.copied };
	return { primed: state.primed === event.action ? null : event.action, copied: null };
}
