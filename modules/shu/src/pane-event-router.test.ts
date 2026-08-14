import { describe, expect, it } from "vitest";
import { createPaneRouteState, paneOpsFor, recordPaneDismissal } from "./pane-event-router.js";
import type { TEvent } from "./event-stream.js";

/** A completed step-end lifecycle event whose products open the given component view. */
const openEvent = (id: string, component: string, over: Record<string, unknown> = {}): TEvent =>
	({
		id,
		timestamp: 100,
		level: "info",
		kind: "lifecycle",
		type: "step",
		stage: "end",
		status: "completed",
		products: { products: { view: component, _component: component, description: component } },
		...over,
	}) as unknown as TEvent;

const noUi = () => undefined;

describe("pane-event-router rule 1: trace substeps are not intent", () => {
	it("a person-visible step-end with view products yields one open op", () => {
		const ops = paneOpsFor([openEvent("ev-1", "shu-affordances-panel")], createPaneRouteState(), noUi);
		expect([...ops.values()]).toEqual([expect.objectContaining({ op: "component", tag: "shu-affordances-panel" })]);
	});

	it("a trace-level substep yields NO op — infrastructure steps can carry view markers without anyone asking for that view", () => {
		const ops = paneOpsFor([openEvent("ev-1", "shu-affordances-panel", { level: "trace" })], createPaneRouteState(), noUi);
		expect(ops.size).toBe(0);
	});
});

describe("pane-event-router rule 2: each event acts once", () => {
	it("a replay-tagged delivery still opens — a page connecting mid-run picks up the views a CLI run opened", () => {
		const ops = paneOpsFor([openEvent("ev-1", "shu-polymorphic-graph-view", { replay: true })], createPaneRouteState(), noUi);
		expect(ops.size).toBe(1);
	});

	it("a re-delivered event (same id, later batch) yields NO op", () => {
		const state = createPaneRouteState();
		expect(paneOpsFor([openEvent("ev-1", "pane-a")], state, noUi).size).toBe(1);
		expect(paneOpsFor([openEvent("ev-1", "pane-a")], state, noUi).size).toBe(0);
	});

	it("within one batch, repeats of the same pane collapse to the latest op while distinct panes each keep theirs", () => {
		const ops = paneOpsFor([openEvent("ev-1", "pane-a"), openEvent("ev-2", "pane-b"), openEvent("ev-3", "pane-a")], createPaneRouteState(), noUi);
		expect([...ops.keys()]).toEqual(["pane-a", "pane-b"]);
	});
});

describe("pane-event-router rule 3: a close outlasts the past", () => {
	it("after a dismissal, an event no newer than the close yields NO op — history cannot resurrect a closed view", () => {
		const state = createPaneRouteState();
		paneOpsFor([openEvent("ev-1", "shu-affordances-panel", { timestamp: 100 })], state, noUi);
		recordPaneDismissal(state, "shu-affordances-panel"); // watermark = 100, the newest event time seen
		const replayAfterReload = paneOpsFor([openEvent("ev-1b", "shu-affordances-panel", { timestamp: 100 })], state, noUi);
		expect(replayAfterReload.size).toBe(0);
	});

	it("a strictly newer event reopens — a freshly run step is a new decision", () => {
		const state = createPaneRouteState();
		paneOpsFor([openEvent("ev-1", "shu-affordances-panel", { timestamp: 100 })], state, noUi);
		recordPaneDismissal(state, "shu-affordances-panel");
		const fresh = paneOpsFor([openEvent("ev-2", "shu-affordances-panel", { timestamp: 101 })], state, noUi);
		expect(fresh.size).toBe(1);
	});

	it("dismissal watermarks round-trip through serialization — a close survives a reload", () => {
		const state = createPaneRouteState();
		paneOpsFor([openEvent("ev-1", "shu-affordances-panel", { timestamp: 100 })], state, noUi);
		const persisted = recordPaneDismissal(state, "shu-affordances-panel");
		// A fresh page: new state seeded from the persisted map; the server replays the same history.
		const reloaded = createPaneRouteState(JSON.parse(JSON.stringify(persisted)));
		const replay = paneOpsFor([openEvent("ev-1", "shu-affordances-panel", { timestamp: 100, replay: true })], reloaded, noUi);
		expect(replay.size).toBe(0);
	});
});

describe("pane-event-router: non-matching events", () => {
	it("non-step-end events and product-less step-ends yield nothing", () => {
		const events = [
			{ id: "log-1", timestamp: 1, kind: "log", level: "info" },
			{ id: "ev-9", timestamp: 2, kind: "lifecycle", type: "step", stage: "end", status: "completed", level: "info" },
		] as unknown as TEvent[];
		expect(paneOpsFor(events, createPaneRouteState(), noUi).size).toBe(0);
	});
});
