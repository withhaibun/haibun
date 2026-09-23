/**
 * What a step requires, and what an action a caller holds allows: every step requires an action, and holding a read at
 * one level allows every narrower read.
 */
import { describe, expect, it } from "vitest";
import { actionUnder, capabilityAllows, readAction, readCeilingOf, requiredAction } from "./actions.js";
import { Access } from "./resources.js";

describe("what a step requires", () => {
	it("is the action it declares", () => {
		expect(requiredAction("Pool", "swim", { capability: "Pool:enter" })).toBe("Pool:enter");
	});

	it("is a public read for a step that declares itself a read", () => {
		expect(requiredAction("Pool", "hours", { read: true })).toBe("Read:public");
	});

	it("is the step's own name for a step that declares nothing, so nobody declaring anything leaves it open", () => {
		expect(requiredAction("Pool", "drain", {})).toBe("Pool:drain");
	});
});

describe("what an action held allows", () => {
	it("allows itself, everything for *, and a prefix ending in *", () => {
		expect(capabilityAllows("Pool:enter", "Pool:enter")).toBe(true);
		expect(capabilityAllows(["*"], "Pool:enter")).toBe(true);
		expect(capabilityAllows(["Pool:*"], "Pool:enter")).toBe(true);
		expect(capabilityAllows(["Pool:drain"], "Pool:enter")).toBe(false);
		expect(capabilityAllows(undefined, "Pool:enter"), "and nothing held allows nothing").toBe(false);
	});

	it("allows a read at any level no broader than the one held", () => {
		expect(capabilityAllows([readAction(Access.private)], readAction(Access.public))).toBe(true);
		expect(capabilityAllows([readAction(Access.private)], readAction(Access.opened))).toBe(true);
		expect(capabilityAllows([readAction(Access.opened)], readAction(Access.public))).toBe(true);
		expect(capabilityAllows([readAction(Access.public)], readAction(Access.private)), "never a broader one").toBe(false);
		expect(capabilityAllows([readAction(Access.opened)], readAction(Access.private))).toBe(false);
		expect(capabilityAllows(["Read:everything"], readAction(Access.public)), "and a level that doesn't exist allows no read").toBe(false);
	});
});

describe("the most a caller reads at", () => {
	it("is the broadest read it holds", () => {
		expect(readCeilingOf(["*"])).toBe(Access.private);
		expect(readCeilingOf(["Read:*"])).toBe(Access.private);
		expect(readCeilingOf(["Pool:enter", readAction(Access.opened)])).toBe(Access.opened);
		expect(readCeilingOf([readAction(Access.public)])).toBe(Access.public);
	});

	it("is none for a caller that holds no read", () => {
		expect(readCeilingOf(["Pool:enter"])).toBeUndefined();
		expect(readCeilingOf([])).toBeUndefined();
	});
});

describe("the action a delegation lets its holder invoke for a call", () => {
	const delegation = { invocationTarget: "https://pool.example", allowedAction: ["Pool:*", "Read:private"], expires: "2099-01-01T00:00:00Z" };

	it("is one it lists that allows what the call requires, since a delegation is matched on exactly what it names", () => {
		expect(actionUnder(delegation, "Pool:enter", "https://pool.example/rpc/Pool-enter")).toBe("Pool:*");
		expect(actionUnder(delegation, "Read:public", "https://pool.example/rpc/Pool-hours")).toBe("Read:private");
		expect(actionUnder(delegation, "Gym:enter", "https://pool.example/rpc/Gym-enter"), "and none where it lists nothing that allows it").toBeUndefined();
	});

	it("is none at a target outside the one it is over, or once it has lapsed", () => {
		expect(actionUnder(delegation, "Pool:enter", "https://pool.example.net/rpc/Pool-enter")).toBeUndefined();
		expect(actionUnder({ ...delegation, expires: "2000-01-01T00:00:00Z" }, "Pool:enter", "https://pool.example/rpc/Pool-enter")).toBeUndefined();
		expect(actionUnder({ ...delegation, expires: undefined }, "Pool:enter", "https://pool.example/rpc/Pool-enter"), "a delegation states when it lapses").toBeUndefined();
	});
});
