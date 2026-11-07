/** The containment cases its unit test checks against the gate's own checks, which the conformance test also replays through translated clauses. */
import { EVERY_ACTION, readAction, type TDelegation } from "@haibun/core/lib/domains/actions.js";
import { Access } from "@haibun/core/lib/domains/resources.js";

/** Held entries and the action each case requires, on which the synchronous gate's check and the containment rules return the same verdict. */
export const GRAMMAR: [string[], string][] = [
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

export const LATER = "2027-06-01T00:00:00.000Z";
export const NOW = Date.parse("2027-01-01T00:00:00.000Z");
const delegation = (more: Partial<TDelegation>): TDelegation => ({ invocationTarget: "https://a.example/lists", expires: LATER, ...more });
/** Delegations, the action and target each case requires at NOW, on which `actionUnder` and the containment rules return the same verdict. */
export const UNDER: [TDelegation, string, string][] = [
	[delegation({ allowedAction: ["Graph:read"] }), "Graph:read", "https://a.example/lists"],
	[delegation({ allowedAction: ["Graph:read"] }), "Graph:read", "https://a.example/lists/eu"],
	[delegation({ allowedAction: ["Graph:read"] }), "Graph:read", "https://a.example/listsx"],
	[delegation({ allowedAction: ["Graph:read"], invocationTarget: "https://a.example/lists/" }), "Graph:read", "https://a.example/lists/eu"],
	[delegation({ allowedAction: ["Graph:read"] }), "Graph:write", "https://a.example/lists"],
	[delegation({}), "Graph:write", "https://a.example/lists"],
	[delegation({ allowedAction: ["Graph:read"], expires: "2026-12-31T23:59:59.000Z" }), "Graph:read", "https://a.example/lists"],
	[delegation({ allowedAction: ["Graph:read"], expires: new Date(NOW).toISOString() }), "Graph:read", "https://a.example/lists"],
];
