/**
 * The primed tap action machine: holds the action primed from the toolbar, or null when idle.
 */
import type { TTapAction } from "../../domains/elements.js";

export type TTapActionState = TTapAction | null;

export const TAP_ACTION_EVENT = { TOGGLE: "toggle", CLEAR: "clear" } as const;

export type TTapActionEvent = { type: typeof TAP_ACTION_EVENT.TOGGLE; action: TTapAction } | { type: typeof TAP_ACTION_EVENT.CLEAR };

export const INITIAL_TAP_ACTION: TTapActionState = null;

export function tapActionTransition(state: TTapActionState, event: TTapActionEvent): TTapActionState {
	if (event.type === TAP_ACTION_EVENT.CLEAR) return null;
	if (event.type === TAP_ACTION_EVENT.TOGGLE) {
		return state === event.action ? null : event.action;
	}
	return state;
}
