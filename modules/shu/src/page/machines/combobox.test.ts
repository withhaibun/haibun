/** The table of a combobox's list: each event from each state. */
import { describe, expect, it } from "vitest";
import { COMBO_EVENT, COMBO_STATUS, INITIAL_COMBO, UNFOCUSED, comboTransition, type TComboState } from "./combobox.js";

const open = (filter: string, focus: number): TComboState => ({ status: COMBO_STATUS.OPEN, filter, focus });

describe("a combobox's list", () => {
	it("opens on every option at an offer, and keeps an open list as it is", () => {
		expect(comboTransition(INITIAL_COMBO, { type: COMBO_EVENT.OFFER })).toEqual(open("", UNFOCUSED));
		expect(comboTransition(open("em", 1), { type: COMBO_EVENT.OFFER })).toEqual(open("em", 1));
	});

	it("filters by typed text, and the focus starts again", () => {
		expect(comboTransition(INITIAL_COMBO, { type: COMBO_EVENT.FILTER, text: "f" })).toEqual(open("f", UNFOCUSED));
		expect(comboTransition(open("e", 2), { type: COMBO_EVENT.FILTER, text: "em" })).toEqual(open("em", UNFOCUSED));
	});

	it("moves the focus within the options it offers", () => {
		expect(comboTransition(open("", UNFOCUSED), { type: COMBO_EVENT.MOVE, by: 1, offered: 3 })).toEqual(open("", 0));
		expect(comboTransition(open("", UNFOCUSED), { type: COMBO_EVENT.MOVE, by: -1, offered: 3 })).toEqual(open("", 0));
		expect(comboTransition(open("", 2), { type: COMBO_EVENT.MOVE, by: 1, offered: 3 })).toEqual(open("", 2));
		expect(comboTransition(open("", 0), { type: COMBO_EVENT.MOVE, by: -1, offered: 3 })).toEqual(open("", 0));
		expect(comboTransition(open("x", UNFOCUSED), { type: COMBO_EVENT.MOVE, by: 1, offered: 0 })).toEqual(open("x", UNFOCUSED));
	});

	it("leaves a closed list closed at a move, and closes at a close", () => {
		expect(comboTransition(INITIAL_COMBO, { type: COMBO_EVENT.MOVE, by: 1, offered: 3 })).toEqual(INITIAL_COMBO);
		expect(comboTransition(open("em", 1), { type: COMBO_EVENT.CLOSE })).toEqual(INITIAL_COMBO);
		expect(comboTransition(INITIAL_COMBO, { type: COMBO_EVENT.CLOSE })).toEqual(INITIAL_COMBO);
	});
});
