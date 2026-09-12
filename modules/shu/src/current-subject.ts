/**
 * What the reader is on, decided in one place.
 *
 * Three readings: the active pane's subject; the latest item of the conversation the reader is in; a chat message the
 * reader selected. One machine moves between them, on a closed list of events that are each a reader's act or a record
 * of the reader's own turn. Anything else that happens on the page (a data arrival, the run being read moving on, a
 * replay, a pane opened by a trace, a resize, a layout coming to rest) is not an event here, so it cannot move the
 * reader. The graph's follow and highlight, the ask's context and the actions bar each read an output of the state
 * rather than holding a piece of it.
 *
 * The transition is a pure function over a table indexed by state and event, so a state or event added without its
 * transitions does not compile. The one instance lives in a shared signal, written only through `dispatchSubjectEvent`.
 */
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { DENOTES } from "@haibun/core/lib/typed-links.js";
import { anIndividual, type TContextPattern } from "./schemas.js";
import { SharedSignal } from "./signals.js";

/** A record: what a pane shows, or what a turn is about. */
export type TRecord = { id: string; label: string };
/** A chat item: one comment of a conversation, and the turn it belongs to. */
export type TItem = { id: string; seqPath: string };

/** What the active pane shows: its context patterns, at the level the pane reads at. Empty patterns is a pane about nothing. */
export type TPaneSubject = { patterns: TContextPattern[]; accessLevel: string };

export const READINGS = ["pane", "latest", "message"] as const;
export type TReading = (typeof READINGS)[number];

/** A turn in flight carries what it was sent about, fixed at `send` from the state it was sent in, and whether the
 *  reader is still in the session it belongs to: a reader who opens another session mid-turn leaves the turn running,
 *  and what it records is not the open session's. */
export type TTurnState = { running: false } | { running: true; about: TTurnContext; ofOpenSession: boolean };

export type TSubjectState = {
	reading: TReading;
	pane: TPaneSubject;
	/** The latest comment the open session recorded, where a session is open. */
	latest: TItem | null;
	/** The chat message the reader selected; held only in the `message` reading. */
	selected: TItem | null;
	turn: TTurnState;
};

/** The context a turn is sent with: the pane's patterns, or one item the turn continues from. */
export type TTurnContext = {
	kind: "pane" | "item";
	patterns: TContextPattern[];
	accessLevel: string;
	/** The turn this one replies to, where it continues a conversation. */
	inReplyTo?: string;
};

export type TSubjectEvent =
	| { type: "openInPane"; pane: TPaneSubject }
	| { type: "paneClosed"; pane: TPaneSubject }
	| { type: "clearSubject" }
	| { type: "send" }
	| { type: "recorded"; item: TItem }
	| { type: "turnEnded" }
	| { type: "stop" }
	| { type: "selectMessage"; item: TItem }
	| { type: "openSession"; latest: TItem | null }
	| { type: "newSession" };
export type TSubjectEventType = TSubjectEvent["type"];
export const SUBJECT_EVENTS = ["openInPane", "paneClosed", "clearSubject", "send", "recorded", "turnEnded", "stop", "selectMessage", "openSession", "newSession"] as const satisfies readonly TSubjectEventType[];

const NO_PANE: TPaneSubject = { patterns: [], accessLevel: "all" };
const IDLE: TTurnState = { running: false };
export const INITIAL_SUBJECT: TSubjectState = { reading: "pane", pane: NO_PANE, latest: null, selected: null, turn: IDLE };

type TTransition<E extends TSubjectEvent> = (state: TSubjectState, event: E) => TSubjectState;
type TTransitions = { [R in TReading]: { [T in TSubjectEventType]: TTransition<Extract<TSubjectEvent, { type: T }>> } };

const paneData: TTransition<Extract<TSubjectEvent, { type: "paneClosed" }>> = (state, { pane }) => ({ ...state, pane });
const toPane: TTransition<Extract<TSubjectEvent, { type: "openInPane" }>> = (state, { pane }) => ({ ...state, reading: "pane", pane, selected: null });
const cleared: TTransition<Extract<TSubjectEvent, { type: "clearSubject" }>> = (state) => ({ ...state, reading: "pane", pane: NO_PANE, selected: null });
/** A comment the running turn recorded is the open session's latest item, where the turn is of the open session. */
const latestRecorded: TTransition<Extract<TSubjectEvent, { type: "recorded" }>> = (state, { item }) => (state.turn.running && state.turn.ofOpenSession ? { ...state, latest: item } : state);
const toMessage: TTransition<Extract<TSubjectEvent, { type: "selectMessage" }>> = (state, { item }) => ({ ...state, reading: "message", selected: item });
/** Leaving for another session leaves a running turn running, and no longer of the open session. */
const leftSession = (turn: TTurnState): TTurnState => (turn.running ? { ...turn, ofOpenSession: false } : turn);
const toSession: TTransition<Extract<TSubjectEvent, { type: "openSession" }>> = (state, { latest }) => ({ ...state, reading: "latest", latest, selected: null, turn: leftSession(state.turn) });
const afresh: TTransition<Extract<TSubjectEvent, { type: "newSession" }>> = (state) => ({ ...state, reading: "pane", latest: null, selected: null, turn: leftSession(state.turn) });
const ended: TTransition<TSubjectEvent> = (state) => ({ ...state, turn: IDLE });
/** A question the turn region accepts fixes what it is about from the state it was sent in, and enters the conversation.
 *  Turns run one at a time, so a question sent while one runs changes nothing (see `sendRefusal`). */
const sent: TTransition<Extract<TSubjectEvent, { type: "send" }>> = (state) =>
	state.turn.running ? state : { ...state, reading: "latest", selected: null, turn: { running: true, about: nextTurnContext(state), ofOpenSession: true } };

const inAnyReading = { paneClosed: paneData, openInPane: toPane, clearSubject: cleared, send: sent, recorded: latestRecorded, turnEnded: ended, stop: ended, selectMessage: toMessage, openSession: toSession, newSession: afresh };
const TRANSITIONS: TTransitions = { pane: inAnyReading, latest: inAnyReading, message: inAnyReading };

/** The next state, for any state and any event. */
export function transition(state: TSubjectState, event: TSubjectEvent): TSubjectState {
	const step = TRANSITIONS[state.reading][event.type] as TTransition<TSubjectEvent>;
	return step(state, event);
}

/** Why a question cannot be sent now, or null where it can. */
export function sendRefusal(state: TSubjectState): string | null {
	return state.turn.running ? "a turn is running; wait for it to answer or stop it" : null;
}

/** The record a set of context patterns names, where they name one. A type names no record. */
function recordNamedBy(patterns: TContextPattern[]): TRecord | null {
	const first = patterns[0];
	return first && first.kind === DENOTES.individual ? { id: first.id, label: first.persistedAs } : null;
}

const itemRecord = (item: TItem): TRecord => ({ id: item.id, label: COMMENT_LABEL });

/** The record every view dims around and a following graph centres: what the reader is on, by reading. */
export function currentSubject(state: TSubjectState): TRecord | null {
	switch (state.reading) {
		case "pane":
			return recordNamedBy(state.pane.patterns);
		case "message":
			return state.selected ? itemRecord(state.selected) : null;
		case "latest":
			// Until the turn records its first comment, the conversation is on what the turn was sent about.
			return state.latest ? itemRecord(state.latest) : state.turn.running && state.turn.ofOpenSession ? recordNamedBy(state.turn.about.patterns) : null;
	}
}

/** What the next question is sent with, by reading: the pane's patterns, or the one item the question continues from.
 *  In the pane reading the question still continues the open session, so a conversation is not left by opening a
 *  record beside it; its context is the pane's, and its targets are the records the pane names. */
export function nextTurnContext(state: TSubjectState): TTurnContext {
	switch (state.reading) {
		case "pane":
			return { kind: "pane", patterns: state.pane.patterns, accessLevel: state.pane.accessLevel, ...(state.latest ? { inReplyTo: state.latest.seqPath } : {}) };
		case "latest":
			return state.latest
				? { kind: "item", patterns: [anIndividual(COMMENT_LABEL, state.latest.id)], accessLevel: state.pane.accessLevel, inReplyTo: state.latest.seqPath }
				: { kind: "pane", patterns: state.pane.patterns, accessLevel: state.pane.accessLevel };
		case "message":
			return state.selected
				? { kind: "item", patterns: [anIndividual(COMMENT_LABEL, state.selected.id)], accessLevel: state.pane.accessLevel, inReplyTo: state.selected.seqPath }
				: { kind: "pane", patterns: state.pane.patterns, accessLevel: state.pane.accessLevel };
	}
}

/** The one instance, shared across every component and bundle. */
export const currentSubjectState = new SharedSignal<TSubjectState>("currentSubject", INITIAL_SUBJECT);

/** The only writer: raise an event, and every reader of the state sees the next one. */
export function dispatchSubjectEvent(event: TSubjectEvent): TSubjectState {
	const next = transition(currentSubjectState.get(), event);
	currentSubjectState.set(next);
	return next;
}
