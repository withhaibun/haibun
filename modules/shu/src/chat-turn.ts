/**
 * The page runs the latest chat turn, which a pane starts and renders.
 *
 * The actions bar removes its ask pane when it closes. A click elsewhere on the page closes the bar. The turn continues
 * until its stream ends or the reader stops it. A pane that mounts attaches to the latest turn and renders its state
 * and each change after it. This module keeps the latest turn after it ends, because a turn can end while no pane is
 * mounted. The pane mounted next renders how that turn ended.
 *
 * One turn runs at a time. A turn is sent with a bundle, the context that goes with the active record, and activates
 * the actions bar's scope with each comment the run records, the question and then the answer, carrying that bundle.
 */
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { SCOPE, dispatchSubjectEvent } from "./current-subject.js";
import { acts, conduit } from "./hypermedia.js";
import type { TBundle, TChatStatus } from "./schemas.js";

/** The state of a turn, updated as its stream delivers chunks. A pane renders it whenever it attaches. */
export type TTurnState = {
	prompt: string;
	/** The context the turn was sent with, which each comment it records carries. */
	bundle: TBundle;
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
	/** Whether the reader is still in the session the turn was asked in. A turn of a session the reader left activates
	 *  nothing. */
	ofOpenSession: boolean;
};

export type TTurnListener = (state: TTurnState) => void;

/** What a turn sends besides its prompt and bundle: the view data, the tool limit, who reads the context, the session
 *  and the turn it replies to. */
export type TTurnEnvelope = { viewLd: unknown[]; maxToolCalls: number; contextReadBy?: string; sessionSeqPath?: string; inReplyTo?: string };

type TTurnRequest = { method: string; prompt: string; bundle: TBundle; envelope: TTurnEnvelope; target: string; why: string };

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

/** Why a new turn cannot start now, or null when one can. A turn is refused while another runs. */
export function turnRefusal(): string | null {
	return latest?.state.status === "running" ? "a turn is running; wait for it to answer or stop it" : null;
}

/** Abort the running turn with the given reason. A turn that already ended is unchanged. */
export function stopTurn(stoppedBy: string): void {
	if (latest?.state.status !== "running") return;
	latest.state.stoppedBy = stoppedBy;
	latest.abort.abort();
}

/** The reader left the session the running turn was asked in. The turn continues, and activates nothing. */
export function leaveTurnSession(): void {
	if (latest?.state.status === "running") latest.state.ofOpenSession = false;
}

const snapshotOf = (state: TTurnState): TTurnState => ({ ...state, recorded: [...state.recorded], activity: [...state.activity] });

function announce(turn: THeldTurn): void {
	const snapshot = snapshotOf(turn.state);
	for (const listener of turn.listeners) listener(snapshot);
}

/**
 * Start a turn, or throw the refusal while one runs. The returned promise resolves when the turn ends.
 * `attachToTurn` delivers the ended state.
 */
export async function startTurn(request: TTurnRequest): Promise<TTurnState> {
	const refusal = turnRefusal();
	if (refusal) throw new Error(refusal);
	const abort = new AbortController();
	const state: TTurnState = {
		prompt: request.prompt,
		bundle: request.bundle,
		seqPath: null,
		recorded: [],
		activity: [],
		text: "",
		error: "",
		status: "running",
		stoppedBy: "",
		ofOpenSession: true,
	};
	const turn: THeldTurn = { state, listeners: new Set(), abort };
	latest = turn;
	const context = JSON.stringify({ patterns: request.bundle.patterns, ...request.envelope });
	try {
		await conduit().followStream(
			acts(request.method, { prompt: request.prompt, context, accessLevel: request.bundle.accessLevel, target: request.target }),
			(data: TStreamChunk) => {
				if (data.recorded && state.seqPath) {
					state.recorded.push(data.recorded.id);
					if (state.ofOpenSession) {
						const record = { id: data.recorded.id, label: data.recorded.persistedAs };
						dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: { record, seqPath: state.seqPath, bundle: state.bundle } });
					}
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
	} catch (err) {
		// The error states the reader's reason for a stop before the stream's error.
		state.error = state.stoppedBy ? `${state.stoppedBy}: ${(err as Error).message}` : (err as Error).message;
		state.status = state.stoppedBy ? "aborted" : "failed";
	} finally {
		announce(turn);
		turn.listeners.clear();
	}
	return state;
}
