import { describe, expect, it } from "vitest";
import { paneOpsFor } from "./pane-event-router.js";
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

describe("the steps that act as view commands", () => {
	it("a step a reader can see in the log yields one open op", () => {
		expect([...paneOpsFor([openEvent("ev-1", "shu-affordances-panel")]).values()]).toEqual([expect.objectContaining({ op: "component", tag: "shu-affordances-panel" })]);
	});

	it("a trace-level substep yields no op, so a view refetching its own data does not reopen itself", () => {
		expect(paneOpsFor([openEvent("ev-1", "shu-affordances-panel", { level: "trace" })]).size).toBe(0);
	});

	it("within one batch, repeats of the same pane collapse to the latest op while distinct panes each keep theirs", () => {
		expect([...paneOpsFor([openEvent("ev-1", "pane-a"), openEvent("ev-2", "pane-b"), openEvent("ev-3", "pane-a")]).keys()]).toEqual(["pane-a", "pane-b"]);
	});

	it("non-step-end events and product-less step-ends yield nothing", () => {
		const events = [
			{ id: "log-1", timestamp: 1, kind: "log", level: "info" },
			{ id: "ev-9", timestamp: 2, kind: "lifecycle", type: "step", stage: "end", status: "completed", level: "info" },
		] as unknown as TEvent[];
		expect(paneOpsFor(events).size).toBe(0);
	});
});
