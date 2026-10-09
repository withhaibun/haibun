import { describe, it, expect } from "vitest";
import { CLASS_LABEL, PROPERTY_LABEL } from "@haibun/core/lib/resources.js";
import { presenterForType, DEFAULT_PRESENTER } from "./node-presenters.js";

describe("node presenters (per-@type, capability-driven default)", () => {
	it("default presenter renders a free chip when it doesn't have a time placement", () => {
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
		const p = presenterForType(PROPERTY_LABEL);
		expect(p.present({ id: "unusedTerm", name: "unusedTerm", type: PROPERTY_LABEL, properties: { inData: false } }, {}).faint).toBe(true);
		expect(p.present({ id: "maker", name: "maker", type: PROPERTY_LABEL }, {}).faint).toBeFalsy();
	});

	it("presenterForType gives a schema type its own mark, and every other type the default", () => {
		expect(presenterForType("Person")).toBe(DEFAULT_PRESENTER);
		expect(presenterForType(CLASS_LABEL).present({ id: "Person", name: "Person", type: CLASS_LABEL }, {}).kind).toBe("square");
		expect(presenterForType(PROPERTY_LABEL).present({ id: "maker", name: "maker", type: PROPERTY_LABEL }, {}).kind).toBe("lozenge");
	});
});
