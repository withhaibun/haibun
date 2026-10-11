import { describe, expect, it } from "vitest";
import { INITIAL_PANES, PANES_EVENT, panesTransition, type TPanesState } from "./panes.js";
import type { DesiredPane } from "../derivations/pane-kinds.js";

const component = (tag: string, extra: Partial<DesiredPane> = {}): DesiredPane => ({ paneType: "component", tag, label: tag, ...extra }) as DesiredPane;
const [GRAPH, MONITOR, ACTIONS] = [component("shu-polymorphic-graph-view"), component("shu-monitor-column"), component("shu-actions-bar", { docked: true })];
const ids = (state: TPanesState): string[] => [...state.desired.keys()];

/** The machine after each event of `events`, from the initial state. */
const after = (...events: Parameters<typeof panesTransition>[1][]): TPanesState => events.reduce(panesTransition, INITIAL_PANES);
const requested = (id: string, pane: DesiredPane, minimizedBefore = false) => ({ type: PANES_EVENT.REQUEST, id, pane, minimizedBefore }) as const;

describe("the pane machine's table", () => {
	it("restores the panes an address names, chooses the active pane it names, and adds each page pane as it stands", () => {
		const state = after(
			{ type: PANES_EVENT.DECLARE, pagePanes: new Map([["shu-actions-bar", { pane: ACTIONS, attributes: {} }]]) },
			{
				type: PANES_EVENT.RESTORE,
				named: new Map([
					["g", GRAPH],
					["m", MONITOR],
				]),
				active: "m",
				pageStanding: new Map([["shu-actions-bar", ACTIONS]]),
			},
		);
		expect(ids(state)).toEqual(["g", "m", "shu-actions-bar"]);
		expect(state.active).toBe("m");
		expect(state.read).toBe(true);
	});

	it("makes the first named pane active where the address doesn't name an open one, and keeps the active pane where it doesn't name a pane", () => {
		expect(after({ type: PANES_EVENT.RESTORE, named: new Map([["g", GRAPH]]), active: "gone", pageStanding: new Map() }).active).toBe("g");
		const kept = after({ type: PANES_EVENT.ACTIVATE, id: "query" }, { type: PANES_EVENT.RESTORE, named: new Map(), active: undefined, pageStanding: new Map() });
		expect(kept.active).toBe("query");
	});

	it("shows a requested pane as the active pane, minimized where the reader minimized it when it was last shown", () => {
		const state = after(requested("g", GRAPH), requested("m", MONITOR, true));
		expect(ids(state)).toEqual(["g", "m"]);
		expect(state.active).toBe("m");
		expect(state.desired.get("m")?.flag).toBe("min");
	});

	it("keeps an open pane's flag and its dock where a request for it doesn't state them", () => {
		const state = after(requested("g", GRAPH), { type: PANES_EVENT.FLAG, id: "g", flag: "min" }, { type: PANES_EVENT.DOCK, id: "g", docked: true }, requested("g", GRAPH));
		expect(state.desired.get("g")).toMatchObject({ flag: "min", docked: true });
	});

	it("leaves the state as it is for an activation of the active pane, a flag it holds, and a pane it doesn't hold", () => {
		const state = after(requested("g", GRAPH));
		expect(panesTransition(state, { type: PANES_EVENT.ACTIVATE, id: "g" })).toBe(state);
		expect(panesTransition(state, { type: PANES_EVENT.FLAG, id: "g", flag: undefined })).toBe(state);
		expect(panesTransition(state, { type: PANES_EVENT.FLAG, id: "gone", flag: "min" })).toBe(state);
		expect(panesTransition(state, { type: PANES_EVENT.DOCK, id: "gone", docked: true })).toBe(state);
		expect(panesTransition(state, { type: PANES_EVENT.DISMISS, id: "gone" })).toBe(state);
	});

	it("docks one pane at a time, returning the pane docked before it to the strip", () => {
		const state = after(requested("g", GRAPH), requested("m", MONITOR), { type: PANES_EVENT.DOCK, id: "g", docked: true }, { type: PANES_EVENT.DOCK, id: "m", docked: true });
		expect(state.desired.get("g")?.docked).toBeUndefined();
		expect(state.desired.get("m")?.docked).toBe(true);
	});

	it("closes a pane, and makes the first pane that isn't a page pane active where it closes the active one", () => {
		const pagePanes = new Map([["shu-actions-bar", { pane: ACTIONS, attributes: {} }]]);
		const state = after(
			{ type: PANES_EVENT.DECLARE, pagePanes },
			{ type: PANES_EVENT.RESTORE, named: new Map(), active: undefined, pageStanding: new Map([["shu-actions-bar", ACTIONS]]) },
			requested("g", GRAPH),
			requested("m", MONITOR),
			{ type: PANES_EVENT.DISMISS, id: "m" },
		);
		expect(ids(state)).toEqual(["shu-actions-bar", "g"]);
		expect(state.active).toBe("g");
	});

	it("returns a page pane that closes to where the page declares it, docked where it docks", () => {
		const pagePanes = new Map([["shu-actions-bar", { pane: ACTIONS, attributes: {} }]]);
		const state = after(
			{ type: PANES_EVENT.DECLARE, pagePanes },
			{
				type: PANES_EVENT.RESTORE,
				named: new Map(),
				active: undefined,
				pageStanding: new Map([["shu-actions-bar", { ...ACTIONS, docked: undefined, flag: "max" } as DesiredPane]]),
			},
			requested("m", MONITOR),
			{ type: PANES_EVENT.DOCK, id: "m", docked: true },
			{ type: PANES_EVENT.DISMISS, id: "shu-actions-bar" },
		);
		expect(state.desired.get("shu-actions-bar")).toEqual(ACTIONS);
		expect(state.desired.get("m")?.docked).toBeUndefined();
	});
});
