// The dispatch-trace → graph projection for the fisheye `sequence` view: each dispatch is a ganttStart..ganttEnd bar on
// its participant lane (verified by round-tripping through the existing quadsToGanttModel), plus call/return message
// edges — or a single denied edge when a required capability was refused.
import { describe, it, expect } from "vitest";
import type { TDispatchTrace } from "../schemas.js";
import { dispatchTracesToQuads, traceParticipant, DISPATCH_FEATURE, DISPATCH_REL } from "./dispatch-sequence.js";
import { quadsToGanttModel } from "./gantt-model.js";

const trace = (over: Partial<TDispatchTrace> & Pick<TDispatchTrace, "stepName" | "seqPath">): TDispatchTrace => ({
	transport: "local",
	authorized: true,
	...over,
});

// Real epoch-ms timestamps (13 digits): quadsToGanttModel.parseTime tries Date.parse first, which reads a small integer
// as a calendar YEAR, so only realistic epoch values round-trip — exactly what a live dispatch carries.
const T0 = 1_700_000_000_000;
const TRACES: TDispatchTrace[] = [
	trace({ stepName: "gotoPage", seqPath: [0, 1, 1], timestamp: T0 + 1000, durationMs: 50 }),
	trace({ stepName: "remoteCall", transport: "remote", remoteHost: "svc.example", seqPath: [0, 1, 2], timestamp: T0 + 5000, durationMs: 300 }),
	trace({ stepName: "privileged", seqPath: [0, 1, 3], timestamp: T0 + 9000, durationMs: 10, capabilityRequired: "admin", authorized: false }),
];

describe("dispatchTracesToQuads", () => {
	it("each dispatch is a gantt-able task bar spanning its real call (start..start+duration)", () => {
		const { tasks } = quadsToGanttModel(dispatchTracesToQuads(TRACES));
		expect(tasks.map((t) => [t.id, t.start, t.end])).toEqual([
			["dispatch:0.1.1", T0 + 1000, T0 + 1050],
			["dispatch:0.1.2", T0 + 5000, T0 + 5300],
			["dispatch:0.1.3", T0 + 9000, T0 + 9010],
		]);
	});

	it("places each dispatch on its target participant's lane", () => {
		expect(traceParticipant(TRACES[0])).toBe("Local");
		expect(traceParticipant(TRACES[1])).toBe("svc.example");
		const quads = dispatchTracesToQuads(TRACES);
		const laneOf = (id: string) => quads.find((q) => q.subject === id && q.predicate === DISPATCH_REL.participant)?.object;
		expect(laneOf("dispatch:0.1.2")).toBe("svc.example");
	});

	it("emits a call+return pair for an authorized dispatch and a single denied edge for a refused one", () => {
		const quads = dispatchTracesToQuads(TRACES);
		const edges = quads.filter((q) => q.objectType === "reference").map((q) => [q.subject, q.predicate, q.object]);
		// authorized local + remote: call (Feature→dispatch) + return (dispatch→Feature)
		expect(edges).toContainEqual([DISPATCH_FEATURE, DISPATCH_REL.call, "dispatch:0.1.1"]);
		expect(edges).toContainEqual(["dispatch:0.1.1", DISPATCH_REL.return, DISPATCH_FEATURE]);
		// refused: a single denied edge, no call/return
		expect(edges).toContainEqual([DISPATCH_FEATURE, DISPATCH_REL.denied, "dispatch:0.1.3"]);
		expect(edges).not.toContainEqual([DISPATCH_FEATURE, DISPATCH_REL.call, "dispatch:0.1.3"]);
	});
});
