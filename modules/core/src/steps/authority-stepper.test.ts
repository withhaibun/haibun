/**
 * `holding only {actions}, {what}`: a statement runs with the listed actions its caller holds and nothing else, as the
 * same caller. It narrows and never widens, so a feature states a caller holding some actions and not others.
 */
import { describe, expect, it } from "vitest";
import { passWithDefaults } from "../lib/test/lib.js";
import { AStepper } from "../lib/astepper.js";
import { OK } from "../schema/protocol.js";
import AuthorityStepper from "./authority-stepper.js";
import LogicStepper from "./logic-stepper.js";

class PingStepper extends AStepper {
	description = "A step that takes Ping:protected, for tests of narrowing what a statement holds.";
	steps = {
		protectedPing: {
			exact: "protected ping",
			capability: "Ping:protected",
			action: () => Promise.resolve(OK),
		},
	};
}

const holds = async (content: string) => (await passWithDefaults([{ path: "/features/holding.feature", content }], [AuthorityStepper, LogicStepper, PingStepper])).ok;

describe("holding only", () => {
	it("runs a statement with a listed action its caller holds", async () => {
		expect(await holds(`holding only "Ping:protected", protected ping`)).toBe(true);
	});

	it("refuses a step whose action the statement doesn't list, though its caller holds it", async () => {
		expect(await holds(`not holding only "Ping:other", protected ping`)).toBe(true);
		expect(await holds(`holding only "Ping:other", protected ping`), "the refusal fails the statement").toBe(false);
	});

	it("never widens: a statement inside a narrower one holds only what both list", async () => {
		expect(await holds(`not holding only "Ping:other", holding only "Ping:protected", protected ping`)).toBe(true);
	});
});
