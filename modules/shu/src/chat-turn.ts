/**
 * The page's latest chat turn, held as one state that events move.
 *
 * A turn is asked, starts when the run names its step, streams its text, its status lines and the comments it records,
 * and ends as completed, failed or stopped. `transition` states each move, and an event outside those moves leaves the
 * state unchanged. The request stream is an adapter that raises the events, and a pane raises `stop`. The turn is
 * page-level, so it continues when the actions bar removes its pane. The conversation decides what the comments a turn
 * records activate. One turn is in flight at a time.
 */
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { SCOPE, activeEntry, scopeEntry, type TEntry, type TRecord, type TSubjectState } from "./current-subject.js";
import { acts, conduit } from "./hypermedia.js";
import { requireStep } from "./rpc-registry.js";
import { reportToRun } from "./client-log.js";
import type { TBundle, TChatStatus, TTurnStatus } from "./schemas.js";
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
	| { type: "erred"; message: string };
export type TTurnEventType = TTurnEvent["type"];
export const TURN_EVENTS = ["ask", "started", "text", "status", "recorded", "stop", "ended", "erred"] as const satisfies readonly TTurnEventType[];

export const IDLE_TURN: TTurnState = { status: "idle" };

/** The step a turn runs. */
export const ASK_STEP = "chatWithContext";

/** The error of a turn whose stream ended before the run started its step. */
export const NOT_STARTED = "the stream ended before the run started the turn's step";

/** Whether a turn with the status was asked and has not ended. No status is not in flight. */
export function inFlight(status: TTurnStatus | undefined): boolean {
	return status === "asking" || status === "running";
}

/** Whether a turn ended between two of its statuses. */
export function turnEnded(before: TTurnStatus | undefined, after: TTurnStatus | undefined): boolean {
	return inFlight(before) && !inFlight(after);
}

/** Why a new turn cannot start now, or null when one can. A turn is refused while another is in flight. */
export function turnRefusal(turn: TTurnState): string | null {
	return inFlight(turn.status) ? "a turn is running; wait for it to answer or stop it" : null;
}

/** The next state, for any state and any event. */
export function transition(turn: TTurnState, event: TTurnEvent): TTurnState {
	if (event.type === "ask") {
		if (inFlight(turn.status)) return turn;
		const { prompt, bundle, session, inReplyTo } = event;
		return { status: "asking", prompt, bundle, session, inReplyTo, seqPath: null, text: "", activity: [], recorded: [], error: "", stoppedBy: "" };
	}
	if (turn.status === "idle" || !inFlight(turn.status)) return turn;
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
type TTurnEnvelope = { viewLd: unknown[]; maxToolCalls: number; contextReadBy?: string; sessionSeqPath?: string; inReplyTo?: string };

type TTurnRequest = { prompt: string; bundle: TBundle; envelope: TTurnEnvelope; target: string };

/** What the next question is made of: the active entry, whose bundle it carries, and the turn it replies to. The turn
 *  is the actions bar's entry where that entry names one, and the transcript shows the branch that ends at it. */
export function nextQuestion(state: TSubjectState): { carries: TEntry | null; repliesTo: TEntry | null } {
	const conversation = scopeEntry(state, SCOPE.actionsBar);
	return { carries: activeEntry(state), repliesTo: conversation?.seqPath ? conversation : null };
}

/** The events a turn's streamed chunks carry. Text is raised at most once a frame, so a stream faster than the page draws
 *  moves the turn once per drawn frame, and `flush` raises what is held before the turn ends. */
class ChunkEvents {
	#text = "";
	#frame: number | undefined;

	raise = (chunk: TStreamChunk): void => {
		if (chunk.recorded) dispatchTurnEvent({ type: "recorded", record: { id: chunk.recorded.id, label: chunk.recorded.persistedAs } });
		if (chunk.status) dispatchTurnEvent({ type: "status", line: chunk.status });
		if (!chunk.text) return;
		this.#text += chunk.text;
		this.#frame ??= requestAnimationFrame(this.flush);
	};

	flush = (): void => {
		if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
		this.#frame = undefined;
		if (this.#text) dispatchTurnEvent({ type: "text", piece: this.#text });
		this.#text = "";
	};
}

/**
 * Ask a turn over the request stream, or throw the refusal while one is in flight. The promise resolves with the ended
 * state. A stop is an event like any other: the request is aborted when the state records one, and its rejection ends
 * the turn as stopped. A turn that does not complete is reported to the run, so the run's log holds the error it shows.
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
	const chunks = new ChunkEvents();
	try {
		await conduit().followStream(acts(requireStep(ASK_STEP), { prompt, context, accessLevel: bundle.accessLevel, target: request.target }), chunks.raise, {
			why: "chat-turn: stream the turn's answer",
			signal: abort.signal,
			onStart: (seqPath) => dispatchTurnEvent({ type: "started", seqPath: formatSeqPath(seqPath) }),
		});
		chunks.flush();
		dispatchTurnEvent({ type: "ended" });
	} catch (err) {
		chunks.flush();
		dispatchTurnEvent({ type: "erred", message: errorDetail(err) });
	} finally {
		unsubscribe();
	}
	const ended = turnState.get();
	if (ended.status === "failed" || ended.status === "stopped") reportToRun("error", "chat-turn", `chat turn ${ended.status}: ${ended.error}`);
	return ended;
}
