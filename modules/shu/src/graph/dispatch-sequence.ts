/**
 * Project step-dispatch traces into graph quads for the fisheye `sequence` view (which replaces the bespoke SVG sequence
 * renderer). Each dispatch becomes ONE time-placed node — a `ganttStart`..`ganttEnd` bar on its target participant's lane,
 * spanning the real call (start = the dispatch's timestamp, e.g. a network request's start; end = start + durationMs) —
 * plus a `call`/`return` pair (or a `denied` edge) to the `Feature` lifeline, which the fisheye draws as the sequence's
 * message lines. The gantt-able node projection is verified by round-tripping through `quadsToGanttModel` (dispatch-sequence.test.ts).
 */
import { LinkRelations } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { TDispatchTrace } from "../schemas.js";

/** The graph these projected quads live in (also the DispatchTask type declared with the topology that maps these rels). */
export const DISPATCH_GRAPH = "DispatchTask";
/** The caller lifeline every dispatch originates from. */
export const DISPATCH_FEATURE = "Feature";

const G_START = LinkRelations.GANTT_START.rel; // "ganttStart" → time-axis placement
const G_END = LinkRelations.GANTT_END.rel; // "ganttEnd"   → bar span end
const NAME = LinkRelations.NAME.rel; // the node's display label (stepName)

/** Predicates the projection emits beyond the canonical gantt/name rels; declared as the DispatchTask type's topology so
 *  the browser classifier resolves the message edges (range: a participant reference) and the lane-grouping property. */
export const DISPATCH_REL = { participant: "dispatchParticipant", call: "dispatchCall", return: "dispatchReturn", denied: "dispatchDenied" } as const;

/** The participant a dispatch targets — its lane on the sequence: the remote host, the subprocess, or the local process. */
export function traceParticipant(t: TDispatchTrace): string {
	if (t.transport === "remote" && t.remoteHost) return t.remoteHost;
	if (t.transport === "subprocess") return "Subprocess";
	return "Local";
}

/** One stable node id per dispatch (its position in the run). */
const dispatchId = (t: TDispatchTrace): string => `dispatch:${t.seqPath.join(".")}`;

/** Project dispatch traces to quads. Node = a DispatchTask bar (ganttStart..ganttEnd) on its participant lane, labelled by
 *  stepName; edges = call (Feature→dispatch) + return (dispatch→Feature), or denied when a required capability was refused. */
export function dispatchTracesToQuads(traces: TDispatchTrace[], graph: string = DISPATCH_GRAPH): TQuad[] {
	const quads: TQuad[] = [];
	const lit = (subject: string, predicate: string, object: unknown): void => {
		quads.push({ subject, predicate, object, namedGraph: graph });
	};
	const ref = (subject: string, predicate: string, object: string): void => {
		quads.push({ subject, predicate, object, namedGraph: graph, objectType: "reference" });
	};
	for (const t of traces) {
		const id = dispatchId(t);
		const start = t.timestamp ?? 0;
		lit(id, G_START, start);
		lit(id, G_END, start + (t.durationMs ?? 0));
		lit(id, NAME, t.stepName);
		lit(id, DISPATCH_REL.participant, traceParticipant(t));
		if (t.capabilityRequired) lit(id, "capabilityRequired", t.capabilityRequired);
		lit(id, "authorized", t.authorized);
		if (!!t.capabilityRequired && !t.authorized) {
			ref(DISPATCH_FEATURE, DISPATCH_REL.denied, id);
		} else {
			ref(DISPATCH_FEATURE, DISPATCH_REL.call, id);
			ref(id, DISPATCH_REL.return, DISPATCH_FEATURE);
		}
	}
	return quads;
}
