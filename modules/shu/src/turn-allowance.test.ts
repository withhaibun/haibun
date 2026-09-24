/**
 * What a page allows the turns it asks: kept in the page's own store beside its key, so a reload reads it back, each
 * action stated once, and nothing the reader withdrew.
 */
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { readKept } from "./page-key.js";
import { TURN_ALLOWANCE_KEPT_AS, allowForTurns, readTurnAllowance, turnAllowance, withdrawFromTurns } from "./turn-allowance.js";

describe("what a page allows its turns", () => {
	it("is kept in the page's own store, states an action once, and loses what the reader withdraws", async () => {
		expect(await readTurnAllowance(), "nothing until the reader allows something").toEqual([]);
		await allowForTurns("Example:act");
		await allowForTurns("Example:act");
		await allowForTurns("Example:read");
		expect(turnAllowance.get()).toEqual(["Example:act", "Example:read"]);
		expect(await readKept(TURN_ALLOWANCE_KEPT_AS), "kept beside the page's key, so a reload reads it back").toEqual(["Example:act", "Example:read"]);
		await withdrawFromTurns("Example:act");
		expect(turnAllowance.get()).toEqual(["Example:read"]);
		expect(await readKept(TURN_ALLOWANCE_KEPT_AS)).toEqual(["Example:read"]);
	});
});
