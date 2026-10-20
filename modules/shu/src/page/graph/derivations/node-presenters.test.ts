import { describe, it, expect } from "vitest";
import { CLASS_LABEL, LinkRelations, PROPERTY_LABEL, SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { RECORDED_STATUS, SUBSTEP_LEVEL } from "@haibun/core/lib/domains/protocol.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { MARK_COLOUR } from "../../derivations/status-mark.js";
import { colorForType } from "./type-colors.js";
import { presenterForType, CAPABILITY_PRESENTER } from "./node-presenters.js";

describe("node presenters (per-@type, capability-driven default)", () => {
	it("default presenter renders a free chip when it doesn't have a time placement", () => {
		const m = CAPABILITY_PRESENTER.present({ id: "a", name: "Alice", type: "Person" }, {});
		expect(m).toMatchObject({ kind: "chip", label: "Alice", role: { kind: "free" } });
		expect(m.color).toBeTruthy(); // a stable per-type colour (shared colorForType)
	});

	it("default presenter renders a duration box with a time role when the layout placed it as a task", () => {
		const m = CAPABILITY_PRESENTER.present({ id: "t1", name: "Design", type: "Task" }, { time: { start: 10, end: 30, zExtent: 44 } });
		expect(m).toMatchObject({ kind: "box", zExtent: 44, role: { kind: "time", start: 10, end: 30 } });
	});

	it("default presenter draws a chip hollow where its projection requests", () => {
		expect(CAPABILITY_PRESENTER.present({ id: "r1:X1", name: "X1", type: "r1", hollow: true }, {})).toMatchObject({ kind: "chip", hollow: true });
		expect(CAPABILITY_PRESENTER.present({ id: "a", name: "Alice", type: "Person" }, {}).hollow).toBeUndefined();
	});

	it("a cluster is never a box, even when a time placement is present", () => {
		const m = CAPABILITY_PRESENTER.present({ id: "c", name: "+3", type: "Task", isCluster: true }, { time: { start: 0, end: 1, zExtent: 5 } });
		expect(m.kind).toBe("chip");
	});

	it("a schema Property a standard declares but the data never uses (inData=false) is marked faint; a present one is not", () => {
		const p = presenterForType(PROPERTY_LABEL);
		expect(p.present({ id: "unusedTerm", name: "unusedTerm", type: PROPERTY_LABEL, properties: { inData: false } }, {}).faint).toBe(true);
		expect(p.present({ id: "maker", name: "maker", type: PROPERTY_LABEL }, {}).faint).toBeFalsy();
	});

	it.each([
		{ said: "a passed step", properties: { [LinkRelations.ACTION_STATUS.rel]: RECORDED_STATUS.completed }, color: MARK_COLOUR.ok },
		{ said: "a failed step", properties: { [LinkRelations.ACTION_STATUS.rel]: RECORDED_STATUS.failed }, color: MARK_COLOUR.fault },
		{ said: "a running level", properties: { [LinkRelations.ACTION_STATUS.rel]: RECORDED_STATUS.running }, color: MARK_COLOUR.pending },
		{
			said: "a nested call that failed",
			properties: { [LinkRelations.ACTION_STATUS.rel]: RECORDED_STATUS.failed, [SEQ_PATH_FIELD.level]: SUBSTEP_LEVEL },
			color: MARK_COLOUR.undecided,
		},
		{ said: "a record that doesn't state an outcome", properties: {}, color: colorForType(SEQ_PATH_LABEL) },
	])("colours $said by the outcome its record states, as a timeline marks its row", ({ properties, color }) => {
		expect(CAPABILITY_PRESENTER.present({ id: "1-0.1.1.1", name: "a step", type: SEQ_PATH_LABEL, properties }, {}).color).toBe(color);
	});

	it("presenterForType gives a schema type its own mark, and every other type the default", () => {
		expect(presenterForType("Person")).toBe(CAPABILITY_PRESENTER);
		expect(presenterForType(CLASS_LABEL).present({ id: "Person", name: "Person", type: CLASS_LABEL }, {}).kind).toBe("square");
		expect(presenterForType(PROPERTY_LABEL).present({ id: "maker", name: "maker", type: PROPERTY_LABEL }, {}).kind).toBe("lozenge");
	});
});
