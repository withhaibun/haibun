import { describe, expect, it } from "vitest";
import { actionUnder, capabilityAllows, EVERY_ACTION, NEVER_EXPIRES, permissionOf, readAction, type TDelegation } from "@haibun/core/lib/domains/actions.js";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { reasoner } from "../root.js";
import { containment } from "./containment.js";

const exceeding = async (candidate: Parameters<typeof containment>[1], bound: Parameters<typeof containment>[2]) => (await containment(reasoner(), candidate, bound)).exceeds;

/** Held entries and the action each case requires, on which the synchronous gate's check and the containment rules return the same verdict. */
const GRAMMAR: [string[], string][] = [
	[[EVERY_ACTION], "Graph:write"],
	[["Graph:write"], "Graph:write"],
	[["Graph:write"], "Graph:read"],
	[["Graph:*"], "Graph:read"],
	[["Graph:*"], "Graphs:read"],
	[["Graph:*"], "Mail:send"],
	[[readAction(Access.private)], readAction(Access.public)],
	[[readAction(Access.public)], readAction(Access.private)],
	[[readAction(Access.public)], readAction(Access.public)],
	[["Read:*"], readAction(Access.private)],
	[[], "Graph:read"],
	[["Mail:send", "Graph:read"], "Graph:read"],
];

const LATER = "2027-06-01T00:00:00.000Z";
const NOW = Date.parse("2027-01-01T00:00:00.000Z");
const delegation = (more: Partial<TDelegation>): TDelegation => ({ invocationTarget: "https://a.example/lists", expires: LATER, ...more });
/** Delegations, the action and target each case requires at NOW, on which `actionUnder` and the containment rules return the same verdict. */
const UNDER: [TDelegation, string, string][] = [
	[delegation({ allowedAction: ["Graph:read"] }), "Graph:read", "https://a.example/lists"],
	[delegation({ allowedAction: ["Graph:read"] }), "Graph:read", "https://a.example/lists/eu"],
	[delegation({ allowedAction: ["Graph:read"] }), "Graph:read", "https://a.example/listsx"],
	[delegation({ allowedAction: ["Graph:read"], invocationTarget: "https://a.example/lists/" }), "Graph:read", "https://a.example/lists/eu"],
	[delegation({ allowedAction: ["Graph:read"] }), "Graph:write", "https://a.example/lists"],
	[delegation({}), "Graph:write", "https://a.example/lists"],
	[delegation({ allowedAction: ["Graph:read"], expires: "2026-12-31T23:59:59.000Z" }), "Graph:read", "https://a.example/lists"],
	[delegation({ allowedAction: ["Graph:read"], expires: new Date(NOW).toISOString() }), "Graph:read", "https://a.example/lists"],
];

describe("containment", () => {
	it("returns the synchronous gate's verdict on an action against what a caller holds", async () => {
		for (const [held, required] of GRAMMAR) {
			const exceeds = await exceeding({ actions: [required] }, { actions: held });
			expect(exceeds.length === 0, `${held.join(",")} allowing ${required}`).toBe(capabilityAllows(held, required));
		}
	});

	it("returns the verdict of `actionUnder` on a delegation's action at a target and a time", async () => {
		for (const [held, required, target] of UNDER) {
			const exceeds = await exceeding({ actions: [required], target, usedAt: new Date(NOW).toISOString() }, permissionOf(held));
			expect(exceeds.length === 0, `${JSON.stringify(held)} for ${required} at ${target}`).toBe(actionUnder(held, required, target, NOW) !== undefined);
		}
	});

	it("contains a delegation in its parent where each action, its target and its expiry are within the parent's", async () => {
		const parent = { actions: ["TrustedList:registerAnchor"], target: "https://lists.example/trusted-lists", expires: "2027-06-01T00:00:00Z" };
		const child = { actions: ["TrustedList:registerAnchor"], target: "https://lists.example/trusted-lists/eu", expires: "2027-01-01T00:00:00Z" };
		const { exceeds, proof } = await containment(reasoner(), child, parent);
		expect(exceeds).toEqual([]);
		expect(proof.gives.map(({ predicate }) => predicate)).toEqual(["<urn:haibun:containedIn>"]);
	});

	it("returns each action, target and expiry a delegation holds beyond its parent as the witness", async () => {
		const parent = { actions: ["TrustedList:registerAnchor"], target: "https://lists.example/trusted-lists", expires: "2027-06-01T00:00:00Z" };
		const exceeds = await exceeding({ actions: ["TrustedList:withdrawAnchor"], target: "https://lists.example/other", expires: "2027-07-01T00:00:00Z" }, parent);
		expect(exceeds).toEqual(
			expect.arrayContaining([
				{ kind: "action", value: "TrustedList:withdrawAnchor" },
				{ kind: "target", value: "https://lists.example/other" },
				{ kind: "expires", value: "2027-07-01T00:00:00Z" },
			]),
		);
		expect(exceeds).toHaveLength(3);
	});

	it("holds a delegation that doesn't end beyond a parent that does", async () => {
		expect(await exceeding({ actions: ["Graph:read"] }, { actions: ["Graph:read"], expires: LATER })).toEqual([{ kind: "expires", value: NEVER_EXPIRES }]);
	});

	it("contains a use at any time in a bound that doesn't end, as a root capability doesn't", async () => {
		expect(await exceeding({ actions: [], target: "https://a.example/x", usedAt: LATER }, { actions: [EVERY_ACTION], target: "https://a.example/x" })).toEqual([]);
	});
});
