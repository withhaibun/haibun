/** The table of a tap action machine: toggling actions and clearing. */
import { describe, expect, it } from "vitest";
import { INITIAL_TAP_ACTION, TAP_ACTION_EVENT, tapActionTransition } from "./tap-action.js";

describe("tap action machine", () => {
	it("primes an action from null", () => {
		expect(tapActionTransition(INITIAL_TAP_ACTION, { type: TAP_ACTION_EVENT.TOGGLE, action: "close" })).toBe("close");
	});

	it("switches to another action when an action is already primed", () => {
		expect(tapActionTransition("close", { type: TAP_ACTION_EVENT.TOGGLE, action: "settings" })).toBe("settings");
	});

	it("unprimes when the same action is toggled again", () => {
		expect(tapActionTransition("settings", { type: TAP_ACTION_EVENT.TOGGLE, action: "settings" })).toBeNull();
	});

	it("clears a primed action on clear", () => {
		expect(tapActionTransition("copy", { type: TAP_ACTION_EVENT.CLEAR })).toBeNull();
		expect(tapActionTransition(null, { type: TAP_ACTION_EVENT.CLEAR })).toBeNull();
	});
});
