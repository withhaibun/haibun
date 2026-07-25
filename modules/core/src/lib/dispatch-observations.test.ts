// Each step dispatch is observed as graph quads on the bounded substrate: a ganttStart..ganttEnd DispatchTask bar (the
// real call interval) on its participant lane + call/return message edges — or a single denied edge when a capability
// was refused. Emitted into the hidden `observation/dispatch` instrumentation graph.
import { describe, it, expect } from "vitest";
import { observeDispatchTrace, DISPATCH_OBSERVATION_GRAPH, DISPATCH_FEATURE, DISPATCH_REL } from "./dispatch-observations.js";
import { extractQuadsFromEvents } from "./quad-types.js";
import { LinkRelations } from "./resources.js";
import type { TWorld } from "./world.js";
import type { TDispatchTraceArtifact } from "../schema/protocol.js";

type TTrace = TDispatchTraceArtifact["trace"];
const trace = (over: Partial<TTrace> & Pick<TTrace, "stepName" | "seqPath">): TTrace => ({ transport: "local", authorized: true, ...over });

/** Run observeDispatchTrace against a capturing logger and read back the observed quads. */
function observe(...calls: Array<[TTrace, number]>) {
	const events: Record<string, unknown>[] = [];
	const world = { eventLogger: { emit: (e: Record<string, unknown>) => events.push(e) } } as unknown as TWorld;
	for (const [t, ts] of calls) observeDispatchTrace(world, t, ts);
	return extractQuadsFromEvents(events);
}
const val = (quads: ReturnType<typeof observe>, subject: string, predicate: string) => quads.find((q) => q.subject === subject && q.predicate === predicate)?.object;

const T = 1_700_000_000_000;

describe("observeDispatchTrace", () => {
	it("observes a DispatchTask bar spanning the real call, on its participant lane, in the hidden observation graph", () => {
		const quads = observe([trace({ stepName: "gotoPage", seqPath: [0, 1, 1], durationMs: 50 }), T + 1050]);
		const id = "dispatch:0.1.1";
		expect(val(quads, id, LinkRelations.GANTT_START.rel)).toBe(T + 1000); // end - durationMs = the call's start
		expect(val(quads, id, LinkRelations.GANTT_END.rel)).toBe(T + 1050);
		expect(val(quads, id, LinkRelations.NAME.rel)).toBe("gotoPage");
		expect(val(quads, id, DISPATCH_REL.participant)).toBe("Local");
		expect(quads.every((q) => q.namedGraph === DISPATCH_OBSERVATION_GRAPH)).toBe(true);
	});

	it("lanes a remote dispatch under its host and pairs a call with a return", () => {
		const quads = observe([trace({ stepName: "fetch", transport: "remote", remoteHost: "svc.example", seqPath: [0, 2], durationMs: 300 }), T + 5300]);
		const id = "dispatch:0.2";
		expect(val(quads, id, DISPATCH_REL.participant)).toBe("svc.example");
		const edges = quads.filter((q) => q.objectType === "reference").map((q) => [q.subject, q.predicate, q.object]);
		expect(edges).toContainEqual([DISPATCH_FEATURE, DISPATCH_REL.call, id]);
		expect(edges).toContainEqual([id, DISPATCH_REL.return, DISPATCH_FEATURE]);
	});

	it("emits a single denied edge (no call/return) when a required capability was refused", () => {
		const quads = observe([trace({ stepName: "privileged", seqPath: [0, 3], durationMs: 10, capabilityRequired: "admin", authorized: false }), T + 9010]);
		const id = "dispatch:0.3";
		const edges = quads.filter((q) => q.objectType === "reference").map((q) => [q.subject, q.predicate, q.object]);
		expect(edges).toContainEqual([DISPATCH_FEATURE, DISPATCH_REL.denied, id]);
		expect(edges).not.toContainEqual([DISPATCH_FEATURE, DISPATCH_REL.call, id]);
	});
});
