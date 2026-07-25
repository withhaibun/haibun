/**
 * Observe each step dispatch as graph quads, so the step-dispatch sequence lives on the bounded graph substrate the
 * fisheye reads (`getClusteredQuads`) instead of as an unbounded client event-log window. One DispatchTask node per
 * dispatch — a `ganttStart`..`ganttEnd` bar spanning the real call interval, on its target participant's lane, labelled by
 * stepName — plus a `call`/`return` pair (or a `denied` edge) to the `Feature` lifeline, which the fisheye's `sequence`
 * view draws as the message lines. Emitted into an `observation/*` graph, so it is instrumentation
 * (`isInstrumentationGraph`) — hidden by default, shown deliberately by the sequence view. Mirrors http-observations.
 */
import type { TWorld } from "./world.js";
import { emitQuadObservation } from "./quad-types.js";
import { LinkRelations } from "./resources.js";
import type { TDispatchTraceArtifact } from "../schema/protocol.js";

type TTrace = TDispatchTraceArtifact["trace"];

export const DISPATCH_OBSERVATION_GRAPH = "observation/dispatch";
/** The caller lifeline every dispatch originates from. */
export const DISPATCH_FEATURE = "Feature";
/** Predicates beyond the canonical gantt/name/seqPath rels — the lane-grouping key and the message edges. */
export const DISPATCH_REL = { participant: "dispatchParticipant", call: "dispatchCall", return: "dispatchReturn", denied: "dispatchDenied" } as const;

/** The participant a dispatch targets — its lane on the sequence: the remote host, the subprocess, or the local process. */
export function traceParticipant(t: TTrace): string {
	if (t.transport === "remote" && t.remoteHost) return t.remoteHost;
	if (t.transport === "subprocess") return "Subprocess";
	return "Local";
}

/**
 * Emit one dispatch's DispatchTask node + message edges as quad observations. `endTimestamp` is the dispatch's end
 * (epoch ms, the artifact's timestamp); the bar starts `durationMs` earlier so it spans the real call. Never throws on a
 * malformed trace — it rides the hot dispatch path, so a bad observation must not fail the step.
 */
export function observeDispatchTrace(world: TWorld, trace: TTrace, endTimestamp: number): void {
	const namedGraph = DISPATCH_OBSERVATION_GRAPH;
	const id = `dispatch:${trace.seqPath.join(".")}`;
	const end = endTimestamp;
	const start = end - (trace.durationMs ?? 0);
	const emit = (suffix: string, subject: string, predicate: string, object: unknown, objectType?: string): void =>
		emitQuadObservation(world.eventLogger, `quad-${id}-${suffix}`, { subject, predicate, object, namedGraph, timestamp: endTimestamp, ...(objectType ? { objectType } : {}) });
	emit("start", id, LinkRelations.GANTT_START.rel, start); // → time-axis placement (the bar's start)
	emit("end", id, LinkRelations.GANTT_END.rel, end); // → the bar's span
	emit("name", id, LinkRelations.NAME.rel, trace.stepName); // the node's label
	emit("participant", id, DISPATCH_REL.participant, traceParticipant(trace)); // → the lane grouping
	emit("seqpath", id, LinkRelations.SEQ_PATH.rel, trace.seqPath);
	if (trace.capabilityRequired && !trace.authorized) {
		emit("denied", DISPATCH_FEATURE, DISPATCH_REL.denied, id, "reference");
	} else {
		emit("call", DISPATCH_FEATURE, DISPATCH_REL.call, id, "reference");
		emit("return", id, DISPATCH_REL.return, DISPATCH_FEATURE, "reference");
	}
}
