import { describe, it, expect } from "vitest";
import { presenterForType, registerNodePresenter, DEFAULT_PRESENTER, type NodePresenter } from "./node-presenters.js";
import { assertNodeMark } from "./graph-scene.js";
import { ONTOLOGY_PROPERTY } from "./ontology-projection.js";

describe("node presenters (per-@type, capability-driven default)", () => {
	it("default presenter renders a free chip when there's no time placement", () => {
		const m = DEFAULT_PRESENTER.present({ id: "a", name: "Alice", type: "Person" }, {});
		expect(m).toMatchObject({ kind: "chip", label: "Alice", role: { kind: "free" } });
		expect(m.color).toBeTruthy(); // a stable per-type colour (shared colorForType)
	});

	it("default presenter renders a duration box with a time role when the layout placed it as a task", () => {
		const m = DEFAULT_PRESENTER.present({ id: "t1", name: "Design", type: "Task" }, { time: { start: 10, end: 30, zExtent: 44 } });
		expect(m).toMatchObject({ kind: "box", zExtent: 44, role: { kind: "time", start: 10, end: 30 } });
	});

	it("a cluster is never a box, even when a time placement is present", () => {
		const m = DEFAULT_PRESENTER.present({ id: "c", name: "+3", type: "Task", isCluster: true }, { time: { start: 0, end: 1, zExtent: 5 } });
		expect(m.kind).toBe("chip");
	});

	it("a schema Property a standard declares but the data never uses (inData=false) is marked faint; a present one is not", () => {
		const p = presenterForType(ONTOLOGY_PROPERTY);
		expect(p.present({ id: "unusedTerm", name: "unusedTerm", type: ONTOLOGY_PROPERTY, properties: { inData: false } }, {}).faint).toBe(true);
		expect(p.present({ id: "maker", name: "maker", type: ONTOLOGY_PROPERTY }, {}).faint).toBeFalsy();
	});

	it("presenterForType falls back to the default, and a registered @type overrides it", () => {
		expect(presenterForType("Unregistered")).toBe(DEFAULT_PRESENTER);
		const square: NodePresenter = { present: (n) => assertNodeMark({ id: n.id, type: n.type, kind: "mesh", label: n.name, color: "#111", role: { kind: "free" } }) };
		registerNodePresenter("Widget", square);
		expect(presenterForType("Widget")).toBe(square);
		expect(presenterForType("Widget").present({ id: "w", name: "W", type: "Widget" }, {}).kind).toBe("mesh");
	});
});
