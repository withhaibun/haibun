/**
 * What a step requires, and what an action a caller holds allows: every step requires an action, and holding a read at
 * one level allows every narrower read.
 */
import { describe, expect, it } from "vitest";
import {
	EVERY_ACTION,
	actionUnder,
	allowedActionFor,
	capabilityAllows,
	delegatedActions,
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
import { Access, levelsWithin } from "./resources.js";

describe("what a step requires", () => {
	it("is the action it declares", () => {
		expect(requiredAction("Pool", "swim", { capability: "Pool:enter" })).toBe("Pool:enter");
	});

	it("is a public read for a step that declares itself a read", () => {
		expect(requiredAction("Pool", "hours", { read: true })).toBe("Read:public");
	});

	it("is the step's own name for a step that doesn't declare a requirement, so omitting a declaration doesn't leave it open", () => {
		expect(requiredAction("Pool", "drain", {})).toBe("Pool:drain");
	});
});

describe("whether a caller may call a step", () => {
	it("is whether what it holds allows the action the step requires", () => {
		expect(mayCall(["Read:private"], { capability: "Read:public" })).toBe(true);
		expect(mayCall(["Pool:enter"], { capability: "Pool:drain" })).toBe(false);
		expect(mayCall(undefined, { capability: "Read:public" }), "and not holding an action doesn't allow a call").toBe(false);
	});

	it("names the action it lacks: the one the step requires, or else a read at the level the step reads at", () => {
		const readsThePage = { capability: "Pool:look", readsAt: Access.private };
		expect(lackedAction(["Read:public"], readsThePage)).toBe("Pool:look");
		expect(lackedAction(["Pool:look", "Read:public"], readsThePage)).toBe(readAction(Access.private));
		expect(lackedAction(["Pool:look", "Read:private"], readsThePage)).toBeUndefined();
		expect(mayCall(["Pool:look", "Read:public"], readsThePage)).toBe(false);
	});
});

describe("what an action held allows", () => {
	it("allows itself, everything for *, and a prefix ending in *", () => {
		expect(capabilityAllows("Pool:enter", "Pool:enter")).toBe(true);
		expect(capabilityAllows(["*"], "Pool:enter")).toBe(true);
		expect(capabilityAllows(["Pool:*"], "Pool:enter")).toBe(true);
		expect(capabilityAllows(["Pool:drain"], "Pool:enter")).toBe(false);
		expect(capabilityAllows(undefined, "Pool:enter"), "and not holding an action doesn't allow one").toBe(false);
	});

	it("allows a read at any level no broader than the one held", () => {
		expect(capabilityAllows([readAction(Access.private)], readAction(Access.public))).toBe(true);
		expect(capabilityAllows([readAction(Access.private)], readAction(Access.opened))).toBe(true);
		expect(capabilityAllows([readAction(Access.opened)], readAction(Access.public))).toBe(true);
		expect(capabilityAllows([readAction(Access.public)], readAction(Access.private)), "never a broader one").toBe(false);
		expect(capabilityAllows([readAction(Access.opened)], readAction(Access.private))).toBe(false);
		expect(capabilityAllows(["Read:everything"], readAction(Access.public)), "and a level that doesn't exist doesn't allow a read").toBe(false);
	});
});

describe("the most a caller reads at", () => {
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

	it("is one it lists that allows what the call requires, since a delegation is matched on exactly what it names", () => {
		expect(actionUnder(delegation, "Pool:enter", "https://pool.example/rpc/Pool-enter")).toBe("Pool:*");
		expect(actionUnder(delegation, "Read:public", "https://pool.example/rpc/Pool-hours")).toBe("Read:private");
		expect(actionUnder(delegation, "Gym:enter", "https://pool.example/rpc/Gym-enter"), "and undefined where it doesn't list an action that allows it").toBeUndefined();
	});

	it("is undefined at a target outside the one it is over, or once it has lapsed", () => {
		expect(actionUnder(delegation, "Pool:enter", "https://pool.example.net/rpc/Pool-enter")).toBeUndefined();
		expect(actionUnder({ ...delegation, expires: "2000-01-01T00:00:00Z" }, "Pool:enter", "https://pool.example/rpc/Pool-enter")).toBeUndefined();
		expect(actionUnder({ ...delegation, expires: undefined }, "Pool:enter", "https://pool.example/rpc/Pool-enter"), "a delegation states when it lapses").toBeUndefined();
	});
});

describe("what a delegation lists", () => {
	it("doesn't list an action for every action, and reads a delegation that doesn't list an action as allowing every action", () => {
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

	it("narrows the first delegation that allows every action wanted, listing the actions it lists, and ends no later than it", () => {
		expect(narrowing([visitor, lifeguard], { wanted: [ENTER_POOL, readAction(Access.public)], expires: ASKED_LATER, target })).toEqual({
			parent: lifeguard,
			allowedAction: lifeguard.allowedAction,
			expires: LIFEGUARD_ENDS,
		});
		expect(narrowing([visitor], { wanted: [readAction(Access.public)], expires: ASKED_EARLIER, target })?.expires, "and when it was asked to end, where that is earlier").toBe(
			ASKED_EARLIER,
		);
	});

	it("doesn't find one where the delegations held don't allow an action wanted", () => {
		expect(narrowing([visitor], { wanted: [ENTER_POOL], expires: VISITOR_ENDS, target })).toBeUndefined();
	});
});

describe("the level a record is written at", () => {
	const [READS_PRIVATE, PUBLISHES] = [readAction(Access.private), writeAction(Access.public)];
	const run = { ceiling: undefined, held: undefined };
	const reader = { ceiling: Access.private, held: [READS_PRIVATE] };
	const publicReader = { ceiling: Access.public, held: [readAction(Access.public)] };

	it("is the level stated, or else the level its type declares, for a write that a ceiling doesn't bound", () => {
		expect(writtenAt(Access.opened, Access.public, run)).toBe(Access.opened);
		expect(writtenAt(undefined, Access.public, run)).toBe(Access.public);
	});

	it("gives way to the ceiling of a writer that read more than its type shares, where it doesn't hold a write at the type's level", () => {
		expect(writtenAt(undefined, Access.public, reader)).toBe(Access.private);
		expect(writtenAt(undefined, Access.public, { ...reader, held: [READS_PRIVATE, PUBLISHES] }), "and is the type's where it holds that write").toBe(Access.public);
		expect(writtenAt(undefined, Access.public, { ...reader, held: [EVERY_ACTION] }), "as it is for a writer holding every action").toBe(Access.public);
	});

	it("refuses a stated level more public than the writer's ceiling, naming the action it requires", () => {
		expect(() => writtenAt(Access.public, Access.private, reader)).toThrow(PUBLISHES);
	});

	it("is what the writer sees where its type shares less, so the writer reads back what it wrote, or the more private level it states", () => {
		expect(writtenAt(undefined, Access.private, publicReader)).toBe(Access.public);
		expect(writtenAt(Access.private, Access.private, publicReader)).toBe(Access.private);
	});

	it("doesn't refuse a level to a writer that a ceiling doesn't bound or that holds every action, so a store doesn't read a level to check either", () => {
		expect(writesAtEveryLevel(run)).toBe(true);
		expect(writesAtEveryLevel({ ...reader, held: [EVERY_ACTION] })).toBe(true);
		expect(writesAtEveryLevel(reader)).toBe(false);
	});
});

describe("what a read sees", () => {
	it("is the level asked for, never more than the caller's ceiling", () => {
		expect(seenAt(Access.private, Access.opened)).toBe(Access.opened);
		expect(seenAt(Access.public, Access.private)).toBe(Access.public);
		expect(seenAt(Access.private, undefined), "and is what was asked where a ceiling doesn't bound the caller").toBe(Access.private);
	});

	it("is the records at that level and at each narrower one, so a public reader doesn't read an opened record", () => {
		expect(levelsWithin(Access.public)).toEqual([Access.public]);
		expect(levelsWithin(Access.opened)).toEqual([Access.opened, Access.public]);
		expect(levelsWithin(Access.private)).toEqual([Access.private, Access.opened, Access.public]);
	});
});
