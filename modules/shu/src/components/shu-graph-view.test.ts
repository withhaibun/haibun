// @vitest-environment jsdom
// shu-graph-view's show/hide control in isolation: a control product delivered to the `products`
// setter must update `state.hiddenGraphs`, caught here rather than only in an e2e browser run.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuGraphView } from "./shu-graph-view.js";

// Reach reactive state; stub the snapshot refetch so the test needs no RPC.
type Probe = { products: Record<string, unknown>; state: { hiddenGraphs: string[] }; refetchSnapshot: () => Promise<void> };
const makeView = (): Probe => {
	const el = document.createElement("shu-graph-view") as unknown as Probe;
	el.refetchSnapshot = async () => {
		/* probe stub: no snapshot fetch in unit tests */
	};
	return el;
};

describe("shu-graph-view control contract (isolated)", () => {
	beforeEach(() => {
		document.cookie = "shu-graph-hidden=; path=/; max-age=0";
		if (!customElements.get("shu-graph-view")) customElements.define("shu-graph-view", ShuGraphView);
	});

	it("records hideGraphs from a control product into hiddenGraphs, ignoring affordance markers", () => {
		const el = makeView();
		el.products = { hideGraphs: ["facts", "variables"], _component: "shu-graph-view", view: "graph" };
		expect([...el.state.hiddenGraphs].sort()).toEqual(["facts", "variables"]);
	});

	it("treats show/hide as a delta — showGraphs removes only the named types", () => {
		const el = makeView();
		el.products = { hideGraphs: ["facts", "variables", "SeqPath"] };
		el.products = { showGraphs: ["facts"] };
		expect([...el.state.hiddenGraphs].sort()).toEqual(["SeqPath", "variables"]);
	});

	it("is a no-op for a product carrying only affordance markers (a plain open)", () => {
		const el = makeView();
		el.products = { hideGraphs: ["facts"] };
		el.products = { _component: "shu-graph-view", view: "graph" };
		expect(el.state.hiddenGraphs).toEqual(["facts"]);
	});

	it("throws on a malformed control payload (schema-rigorous — no silent miscast)", () => {
		const el = makeView();
		expect(() => {
			el.products = { hideGraphs: "facts" };
		}).toThrow();
	});
});
