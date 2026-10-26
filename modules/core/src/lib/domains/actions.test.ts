/**
 * Tests the action a step requires and what a caller's actions allow. Every step requires an action. Holding a read at
 * one level allows every narrower read.
 */
import { describe, expect, it } from "vitest";
import {
	EVERY_ACTION,
	actionUnder,
	allowedActionFor,
	ActionSchema,
	capabilityAllows,
	delegatedActions,
	heldActions,
	lackedAction,
	mayCall,
	narrowing,
	readAction,
	readCeilingOf,
	requiredAction,
	seenAt,
	writeAction,
	writesAtEveryLevel,
	writtenAt,
} from "./actions.js";
import { Access, levelsWithin, withinAccess } from "./resources.js";

describe("what a step requires", () => {
	it("is the action it declares", () => {
		expect(requiredAction("Pool", "swim", { capability: ActionSchema.parse("Pool:enter") })).toBe("Pool:enter");
	});

	it("is a read at the level a read states", () => {
		expect(requiredAction("Pool", "hours", { read: true, readsAt: Access.public })).toBe("Read:public");
		expect(requiredAction("Pool", "hours", { read: true, readsAt: Access.private })).toBe("Read:private");
	});

	it("is the step's own name for a step that doesn't declare a requirement, so a gate refuses that step to a caller that doesn't hold its name", () => {
		expect(requiredAction("Pool", "drain", {})).toBe("Pool:drain");
	});
});

describe("whether a caller may call a step", () => {
	it("is whether what it holds allows the action the step requires", () => {
		expect(mayCall(["Read:private"], { capability: ActionSchema.parse("Read:public") })).toBe(true);
		expect(mayCall(["Pool:enter"], { capability: ActionSchema.parse("Pool:drain") })).toBe(false);
		expect(mayCall(undefined, { capability: ActionSchema.parse("Read:public") }), "and not holding an action doesn't allow a call").toBe(false);
	});

	it("names the action it lacks: the step's required action, or else a read at the step's level", () => {
		const readsThePage = { capability: ActionSchema.parse("Pool:look"), readsAt: Access.private };
		expect(lackedAction(["Read:public"], readsThePage)).toBe("Pool:look");
		expect(lackedAction(["Pool:look", "Read:public"], readsThePage)).toBe(readAction(Access.private));
		expect(lackedAction(["Pool:look", "Read:private"], readsThePage)).toBeUndefined();
		expect(mayCall(["Pool:look", "Read:public"], readsThePage)).toBe(false);
	});
});

describe("what an action held allows", () => {
	it("allows the action itself, every action for *, and each action a prefix ending in * matches", () => {
		expect(capabilityAllows("Pool:enter", "Pool:enter")).toBe(true);
		expect(capabilityAllows(["*"], "Pool:enter")).toBe(true);
		expect(capabilityAllows(["Pool:*"], "Pool:enter")).toBe(true);
		expect(capabilityAllows(["Pool:drain"], "Pool:enter")).toBe(false);
		expect(capabilityAllows(undefined, "Pool:enter"), "and not holding an action doesn't allow one").toBe(false);
	});

	it("allows a read at the level held and at each narrower level", () => {
		expect(capabilityAllows([readAction(Access.private)], readAction(Access.public))).toBe(true);
		expect(capabilityAllows([readAction(Access.private)], readAction(Access.opened))).toBe(true);
		expect(capabilityAllows([readAction(Access.opened)], readAction(Access.public))).toBe(true);
		expect(capabilityAllows([readAction(Access.public)], readAction(Access.private)), "and doesn't allow a broader one").toBe(false);
		expect(capabilityAllows([readAction(Access.opened)], readAction(Access.private))).toBe(false);
		expect(capabilityAllows(["Read:everything"], readAction(Access.public)), "and a level that doesn't exist doesn't allow a read").toBe(false);
	});
});

describe("the broadest level a caller reads", () => {
	it("is the broadest read it holds", () => {
		expect(readCeilingOf(["*"])).toBe(Access.private);
		expect(readCeilingOf(["Read:*"])).toBe(Access.private);
		expect(readCeilingOf(["Pool:enter", readAction(Access.opened)])).toBe(Access.opened);
		expect(readCeilingOf([readAction(Access.public)])).toBe(Access.public);
	});

	it("is undefined for a caller that doesn't hold a read", () => {
		expect(readCeilingOf(["Pool:enter"])).toBeUndefined();
		expect(readCeilingOf([])).toBeUndefined();
	});
});

describe("the action a delegation lets its holder invoke for a call", () => {
	const delegation = { invocationTarget: "https://pool.example", allowedAction: ["Pool:*", "Read:private"], expires: "2099-01-01T00:00:00Z" };

	it("is an action it lists that allows the call's required action, since a delegation is matched on the actions it names", () => {
		expect(actionUnder(delegation, "Pool:enter", "https://pool.example/rpc/Pool-enter")).toBe("Pool:*");
		expect(actionUnder(delegation, "Read:public", "https://pool.example/rpc/Pool-hours")).toBe("Read:private");
		expect(actionUnder(delegation, "Gym:enter", "https://pool.example/rpc/Gym-enter"), "and undefined where it doesn't list an action that allows it").toBeUndefined();
	});

	it("is undefined at a target outside its invocation target, or after it expires", () => {
		expect(actionUnder(delegation, "Pool:enter", "https://pool.example.net/rpc/Pool-enter")).toBeUndefined();
		expect(actionUnder({ ...delegation, expires: "2000-01-01T00:00:00Z" }, "Pool:enter", "https://pool.example/rpc/Pool-enter")).toBeUndefined();
		expect(actionUnder({ ...delegation, expires: undefined }, "Pool:enter", "https://pool.example/rpc/Pool-enter"), "a delegation states when it expires").toBeUndefined();
	});
});

describe("what a delegation lists", () => {
	it("omits allowedAction for every action, and a delegation without allowedAction allows every action", () => {
		expect(allowedActionFor(["*"]), "zcap-LD reads a listed * as an action's name").toBeUndefined();
		expect(allowedActionFor(["Pool:enter"])).toEqual(["Pool:enter"]);
		expect(delegatedActions({})).toEqual(["*"]);
		expect(delegatedActions({ allowedAction: ["Pool:enter"] })).toEqual(["Pool:enter"]);
	});

	it("invokes the action required under a delegation that doesn't restrict an action", () => {
		const unrestricted = { invocationTarget: "http://site.test", expires: "2099-01-01T00:00:00Z" };
		expect(actionUnder(unrestricted, "Pool:enter", "http://site.test/rpc/x")).toBe("Pool:enter");
	});
});

describe("what a holder delegates to another key", () => {
	const target = "https://pool.example";
	const [POOL, ENTER_POOL] = ["Pool:*", "Pool:enter"];
	const [VISITOR_ENDS, LIFEGUARD_ENDS, ASKED_EARLIER, ASKED_LATER] = ["2099-01-01T00:00:00Z", "2099-06-01T00:00:00Z", "2098-01-01T00:00:00Z", "2100-01-01T00:00:00Z"];
	const lifeguard = { id: "urn:cap:lifeguard", invocationTarget: target, allowedAction: [POOL, readAction(Access.private)], expires: LIFEGUARD_ENDS };
	const visitor = { id: "urn:cap:visitor", invocationTarget: target, allowedAction: [readAction(Access.public)], expires: VISITOR_ENDS };

	it("narrows the first delegation that allows every requested action, lists the parent's actions, and ends at the parent's expiry where that is earlier", () => {
		expect(narrowing([visitor, lifeguard], { wanted: [ENTER_POOL, readAction(Access.public)], expires: ASKED_LATER, target })).toEqual({
			parent: lifeguard,
			allowedAction: lifeguard.allowedAction,
			expires: LIFEGUARD_ENDS,
		});
		expect(narrowing([visitor], { wanted: [readAction(Access.public)], expires: ASKED_EARLIER, target })?.expires, "and at the requested expiry where that is earlier").toBe(
			ASKED_EARLIER,
		);
	});

	it("is undefined where the held delegations don't allow a requested action", () => {
		expect(narrowing([visitor], { wanted: [ENTER_POOL], expires: VISITOR_ENDS, target })).toBeUndefined();
	});
});

describe("the level of a written record", () => {
	const [READS_PRIVATE, PUBLISHES] = [readAction(Access.private), writeAction(Access.public)];
	const run = { ceiling: undefined, held: undefined };
	const reader = { ceiling: Access.private, held: [READS_PRIVATE] };
	const publicReader = { ceiling: Access.public, held: [readAction(Access.public)] };

	it("is the stated level or else the type's declared level for a write that a ceiling doesn't bound", () => {
		expect(writtenAt(Access.opened, Access.public, run)).toBe(Access.opened);
		expect(writtenAt(undefined, Access.public, run)).toBe(Access.public);
	});

	it("is the writer's ceiling where the writer reads at a broader level than the type declares and doesn't hold a write at the type's level", () => {
		expect(writtenAt(undefined, Access.public, reader)).toBe(Access.private);
		expect(writtenAt(undefined, Access.public, { ...reader, held: [READS_PRIVATE, PUBLISHES] }), "and is the type's level where the writer holds that write").toBe(Access.public);
		expect(writtenAt(undefined, Access.public, { ...reader, held: [EVERY_ACTION] }), "as it is for a writer holding every action").toBe(Access.public);
	});

	it("refuses a stated level more public than the writer's ceiling and names the action it requires", () => {
		expect(() => writtenAt(Access.public, Access.private, reader)).toThrow(PUBLISHES);
	});

	it("is the more private level a write states, or else the writer's ceiling where the type's level is more private, so the writer reads back what it wrote", () => {
		expect(writtenAt(undefined, Access.private, publicReader)).toBe(Access.public);
		expect(writtenAt(Access.private, Access.private, publicReader)).toBe(Access.private);
	});

	it("doesn't refuse a level to a writer that a ceiling doesn't bound or that holds every action, so a store doesn't read a record's level for either writer", () => {
		expect(writesAtEveryLevel(run)).toBe(true);
		expect(writesAtEveryLevel({ ...reader, held: [EVERY_ACTION] })).toBe(true);
		expect(writesAtEveryLevel(reader)).toBe(false);
	});
});

describe("what a read returns", () => {
	it("is bounded by the requested level narrowed to the caller's ceiling", () => {
		expect(seenAt(Access.private, Access.opened)).toBe(Access.opened);
		expect(seenAt(Access.public, Access.private)).toBe(Access.public);
		expect(seenAt(Access.private, undefined), "and is the requested level where a ceiling doesn't bound the caller").toBe(Access.private);
	});

	it("is the records at that level and at each narrower one, so a public reader doesn't read an opened record", () => {
		expect(levelsWithin(Access.public)).toEqual([Access.public]);
		expect(levelsWithin(Access.opened)).toEqual([Access.opened, Access.public]);
		expect(levelsWithin(Access.private)).toEqual([Access.private, Access.opened, Access.public]);
	});

	it("refuses a record whose level isn't one of the levels, and a record that doesn't state one", () => {
		expect(() => withinAccess("Private", Access.public)).toThrow(`a record states the access level "Private", which isn't one of private, opened, public`);
		expect(() => withinAccess(undefined, Access.public), "and a record that doesn't state a level").toThrow("a read refuses a record that doesn't state its access level");
	});
});

describe("the actions a caller held", () => {
	it("are read from a comma-separated list, each in an action's grammar", () => {
		expect(heldActions("GraphStepper:createEdge, comment.grant, Read:private")).toEqual(["GraphStepper:createEdge", "comment.grant", "Read:private"]);
		expect(() => heldActions("Read:private, read the store"), "a phrase isn't an action").toThrow();
	});
});
