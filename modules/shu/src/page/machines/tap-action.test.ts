/** The table of the tap action machine: priming, clearing, and the last copy's result. */
import { describe, expect, it } from "vitest";
import { COPY_RESULT, INITIAL_TAP_ACTION, TAP_ACTION_EVENT, tapActionTransition, type TTapActionEvent, type TTapActionState } from "./tap-action.js";

const at = (primed: TTapActionState["primed"], copied: TTapActionState["copied"] = null): TTapActionState => ({ primed, copied });
const toggle = (action: "close" | "settings" | "copy"): TTapActionEvent => ({ type: TAP_ACTION_EVENT.TOGGLE, action });

describe("tap action machine", () => {
	it.each([
		["primes an action from idle", INITIAL_TAP_ACTION, toggle("close"), at("close")],
		["switches to another action", at("close"), toggle("settings"), at("settings")],
		["unprimes the primed action toggled again", at("settings"), toggle("settings"), at(null)],
		["clears the last copy's result on a toggle", at(null, COPY_RESULT.copied), toggle("copy"), at("copy")],
		["clears a primed action and keeps the copy's result", at("copy", COPY_RESULT.empty), { type: TAP_ACTION_EVENT.CLEAR }, at(null, COPY_RESULT.empty)],
		["states what a copy did", at(null), { type: TAP_ACTION_EVENT.COPIED, copied: COPY_RESULT.refused }, at(null, COPY_RESULT.refused)],
	] as const)("%s", (_name, state, event, next) => {
		expect(tapActionTransition(state, event)).toEqual(next);
	});
});
