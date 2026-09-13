/**
 * The page's latest chat turn, held as one state that events move.
 *
 * A turn is asked, starts when the run names its step, streams its text, its status lines and the comments it records,
 * and ends as completed, failed or stopped. `transition` states each move, and an event outside those moves leaves the
 * state unchanged. The request stream is an adapter that raises the events. A pane raises `stop` and `left` and renders
 * the state through a SignalController. The actions bar removes its pane when it closes. The turn is page-level, so it
 * continues, and the pane mounted next renders it as it stands.
 *
 * One turn is in flight at a time. The turn activates the actions bar's scope with each comment it records, the question
 * and then the answer, carrying the bundle it was sent with, while the reader stays in the session it was asked in.
 */
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { SCOPE, activeEntry, dispatchSubjectEvent, scopeEntry, type TEntry, type TRecord, type TSubjectState } from "./current-subject.js";
import { acts, conduit } from "./hypermedia.js";
import type { TBundle, TChatStatus } from "./schemas.js";
import { SharedSignal } from "./signals.js";

/** A turn that was asked, in flight or ended. */
export type TAskedTurn = {
	status: TChatStatus;
	prompt: string;
	/** The context the turn was sent with, which each comment it records carries. */
	bundle: TBundle;
	/** The session the turn was asked in; unset for the turn that starts a session. */
	session?: string;
	/** The seqPath of the turn this turn replies to; unset for a first turn. */
	inReplyTo?: string;
	/** The turn's seqPath in the run, null until its step starts. */
	seqPath: string | null;
	text: string;
	/** The status lines the run streamed, in order: the context sent and each call dispatched. */
	activity: string[];
	/** The comments the run recorded, the question first and then the answer. */
	recorded: TRecord[];
	error: string;
	/** The reason the reader gave to stop the turn, or empty when no reader stopped it. */
	stoppedBy: string;
	/** Whether the reader is still in the session the turn was asked in. A turn of a session the reader left activates nothing. */
	ofOpenSession: boolean;
};

export type TTurnState = { status: "idle" } | TAskedTurn;

export type TTurnEvent =
	| { type: "ask"; prompt: string; bundle: TBundle; session?: string; inReplyTo?: string }
	| { type: "started"; seqPath: string }
	| { type: "text"; piece: string }
	| { type: "status"; line: string }
	| { type: "recorded"; record: TRecord }
	| { type: "stop"; reason: string }
	| { type: "ended" }
	| { type: "erred"; message: string }
	| { type: "left" };
export type TTurnEventType = TTurnEvent["type"];
export const TURN_EVENTS = ["ask", "started", "text", "status", "recorded", "stop", "ended", "erred", "left"] as const satisfies readonly TTurnEventType[];

export const IDLE_TURN: TTurnState = { status: "idle" };

/** The error of a turn whose stream ended before the run started its step. */
export const NOT_STARTED = "the stream ended before the run started the turn's step";

/** The statuses of a turn that was asked and has not ended. */
export const IN_FLIGHT: readonly TChatStatus[] = ["asking", "running"];

/** Whether the turn was asked and has not ended. */
export function turnInFlight(turn: TTurnState): boolean {
	return turn.status !== "idle" && IN_FLIGHT.includes(turn.status);
}

/** Why a new turn cannot start now, or null when one can. A turn is refused while another is in flight. */
export function turnRefusal(turn: TTurnState): string | null {
	return turnInFlight(turn) ? "a turn is running; wait for it to answer or stop it" : null;
}

/** The next state, for any state and any event. */
export function transition(turn: TTurnState, event: TTurnEvent): TTurnState {
	if (event.type === "ask") {
		if (turnInFlight(turn)) return turn;
		const { prompt, bundle, session, inReplyTo } = event;
		return { status: "asking", prompt, bundle, session, inReplyTo, seqPath: null, text: "", activity: [], recorded: [], error: "", stoppedBy: "", ofOpenSession: true };
	}
	if (turn.status === "idle" || !turnInFlight(turn)) return turn;
	switch (event.type) {
		case "started":
			return turn.status === "asking" ? { ...turn, status: "running", seqPath: event.seqPath } : turn;
		case "text":
			return turn.status === "running" ? { ...turn, text: turn.text + event.piece } : turn;
		case "status":
			return turn.status === "running" ? { ...turn, activity: [...turn.activity, event.line] } : turn;
		case "recorded":
			return turn.status === "running" ? { ...turn, recorded: [...turn.recorded, event.record] } : turn;
		case "stop":
			return turn.stoppedBy ? turn : { ...turn, stoppedBy: event.reason };
		case "ended":
			return turn.status === "running" ? { ...turn, status: "completed" } : { ...turn, status: "failed", error: NOT_STARTED };
		case "erred":
			return turn.stoppedBy ? { ...turn, status: "stopped", error: `${turn.stoppedBy}: ${event.message}` } : { ...turn, status: "failed", error: event.message };
		case "left":
			return turn.ofOpenSession ? { ...turn, ofOpenSession: false } : turn;
	}
}

/** The one instance, shared across every component and bundle. */
export const turnState = new SharedSignal<TTurnState>("chatTurn", IDLE_TURN);

/** The only writer: raise an event, and every reader of the turn sees the next state. */
export function dispatchTurnEvent(event: TTurnEvent): TTurnState {
	const next = transition(turnState.get(), event);
	turnState.set(next);
	return next;
}

/** What a turn sends besides its prompt and bundle: the view data, the tool limit, who reads the context, the session
 *  and the turn it replies to. */
export type TTurnEnvelope = { viewLd: unknown[]; maxToolCalls: number; contextReadBy?: string; sessionSeqPath?: string; inReplyTo?: string };

type TTurnRequest = { method: string; prompt: string; bundle: TBundle; envelope: TTurnEnvelope; target: string; why: string };

/** What the next question is made of: the active entry, whose bundle it carries, and the turn it replies to. The turn
 *  is the actions bar's entry where that entry names one, and the transcript shows the branch that ends at it. */
export function nextQuestion(state: TSubjectState): { carries: TEntry | null; repliesTo: TEntry | null } {
	const conversation = scopeEntry(state, SCOPE.actionsBar);
	return { carries: activeEntry(state), repliesTo: conversation?.seqPath ? conversation : null };
}

/** Raise the events one streamed chunk carries. A comment recorded by a turn of the reader's session activates the bar
 *  scope with the turn's bundle. */
function raiseChunk(chunk: TStreamChunk): void {
	if (chunk.recorded) {
		const record = { id: chunk.recorded.id, label: chunk.recorded.persistedAs };
		const turn = dispatchTurnEvent({ type: "recorded", record });
		if (turn.status === "running" && turn.seqPath && turn.ofOpenSession && turn.recorded.includes(record)) {
			dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: { record, seqPath: turn.seqPath, bundle: turn.bundle } });
		}
	}
	if (chunk.status) dispatchTurnEvent({ type: "status", line: chunk.status });
	if (chunk.text) dispatchTurnEvent({ type: "text", piece: chunk.text });
}

/**
 * Ask a turn over the request stream, or throw the refusal while one is in flight. The promise resolves with the ended
 * state. A stop is an event like any other: the request is aborted when the state records one, and its rejection ends
 * the turn as stopped.
 */
export async function startTurn(request: TTurnRequest): Promise<TTurnState> {
	const refusal = turnRefusal(turnState.get());
	if (refusal) throw new Error(refusal);
	const { prompt, bundle, envelope } = request;
	dispatchTurnEvent({ type: "ask", prompt, bundle, session: envelope.sessionSeqPath, inReplyTo: envelope.inReplyTo });
	const abort = new AbortController();
	const unsubscribe = turnState.subscribe((turn) => {
		if (turn.status !== "idle" && turn.stoppedBy) abort.abort();
	});
	const context = JSON.stringify({ patterns: bundle.patterns, ...envelope });
	try {
		await conduit().followStream(acts(request.method, { prompt, context, accessLevel: bundle.accessLevel, target: request.target }), raiseChunk, {
			why: request.why,
			signal: abort.signal,
			onStart: (seqPath) => dispatchTurnEvent({ type: "started", seqPath: formatSeqPath(seqPath) }),
		});
		dispatchTurnEvent({ type: "ended" });
	} catch (err) {
		dispatchTurnEvent({ type: "erred", message: errorDetail(err) });
	} finally {
		unsubscribe();
	}
	return turnState.get();
}
