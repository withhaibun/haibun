/**
 * The page runs the latest chat turn, which a pane starts and renders.
 *
 * The actions bar removes its ask pane when it closes. A click elsewhere on the page closes the bar. The turn continues
 * until its stream ends or the reader stops it. A pane that mounts attaches to the latest turn and renders its state
 * and each change after it. This module keeps the latest turn after it ends, because a turn can end while no pane is
 * mounted. The pane mounted next renders how that turn ended.
 *
 * One turn runs at a time. The turn raises `send` on the current-subject machine when it starts, `recorded` for each
 * comment the run names, and `turnEnded` or `stop` when it ends.
 */
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { dispatchSubjectEvent, sendRefusal, currentSubjectState } from "./current-subject.js";
import { acts, conduit } from "./hypermedia.js";
import type { TChatStatus } from "./schemas.js";

/** The state of a turn, updated as its stream delivers chunks. A pane renders it whenever it attaches. */
export type TTurnState = {
	prompt: string;
	/** The turn's seqPath in the run, null until the stream starts. */
	seqPath: string | null;
	/** The comment ids the run recorded, the question first and then the reply. */
	recorded: string[];
	/** The status lines the run streamed, in order: the context sent and each call dispatched. */
	activity: string[];
	text: string;
	error: string;
	status: TChatStatus;
	/** The reason given to stopTurn, or empty when no reader stopped the turn. */
	stoppedBy: string;
};

export type TTurnListener = (state: TTurnState) => void;

type TTurnRequest = { method: string; prompt: string; context: string; accessLevel: string; target: string; why: string };

type THeldTurn = { state: TTurnState; listeners: Set<TTurnListener>; abort: AbortController };

let latest: THeldTurn | null = null;

/** The latest turn, running or ended, or null before the first. */
export function currentTurn(): TTurnState | null {
	return latest?.state ?? null;
}

/** Call the listener with the latest turn's state now, and with each change while the turn runs. Returns the unsubscribe. */
export function attachToTurn(listener: TTurnListener): () => void {
	if (!latest) return () => undefined;
	const held = latest;
	if (held.state.status === "running") held.listeners.add(listener);
	listener(snapshotOf(held.state));
	return () => held.listeners.delete(listener);
}

/** The machine's refusal of a new turn, or null when one can start. The machine refuses while a turn runs. */
export function turnRefusal(): string | null {
	return sendRefusal(currentSubjectState.get());
}

/** Abort the running turn with the given reason. A turn that already ended is unchanged. */
export function stopTurn(stoppedBy: string): void {
	if (latest?.state.status !== "running") return;
	latest.state.stoppedBy = stoppedBy;
	latest.abort.abort();
}

const snapshotOf = (state: TTurnState): TTurnState => ({ ...state, recorded: [...state.recorded], activity: [...state.activity] });

function announce(turn: THeldTurn): void {
	const snapshot = snapshotOf(turn.state);
	for (const listener of turn.listeners) listener(snapshot);
}

/**
 * Start a turn, or throw the machine's refusal while one runs. The returned promise resolves when the turn ends.
 * `attachToTurn` delivers the ended state.
 */
export async function startTurn(request: TTurnRequest): Promise<TTurnState> {
	const refusal = turnRefusal();
	if (refusal) throw new Error(refusal);
	const abort = new AbortController();
	const state: TTurnState = { prompt: request.prompt, seqPath: null, recorded: [], activity: [], text: "", error: "", status: "running", stoppedBy: "" };
	const turn: THeldTurn = { state, listeners: new Set(), abort };
	latest = turn;
	dispatchSubjectEvent({ type: "send" });
	try {
		await conduit().followStream(
			acts(request.method, { prompt: request.prompt, context: request.context, accessLevel: request.accessLevel, target: request.target }),
			(data: TStreamChunk) => {
				if (data.recorded && state.seqPath) {
					state.recorded.push(data.recorded.id);
					dispatchSubjectEvent({ type: "recorded", item: { id: data.recorded.id, seqPath: state.seqPath } });
				}
				if (data.status) state.activity.push(String(data.status));
				if (data.text) state.text += String(data.text);
				if (data.error) state.error = String(data.error);
				announce(turn);
			},
			{
				why: request.why,
				signal: abort.signal,
				onStart: (seqPath) => {
					state.seqPath = formatSeqPath(seqPath);
					announce(turn);
				},
			},
		);
		state.status = "completed";
		dispatchSubjectEvent({ type: "turnEnded" });
	} catch (err) {
		// The error states the reader's reason for a stop before the stream's error.
		state.error = state.stoppedBy ? `${state.stoppedBy}: ${(err as Error).message}` : (err as Error).message;
		state.status = state.stoppedBy ? "aborted" : "failed";
		dispatchSubjectEvent({ type: state.stoppedBy ? "stop" : "turnEnded" });
	} finally {
		announce(turn);
		turn.listeners.clear();
	}
	return state;
}
