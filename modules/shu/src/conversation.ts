/**
 * The conversation the ask is open on, held as one state that events move.
 *
 * A conversation is a session: the turns grouped under a first turn's seqPath. It is closed, opening while the store
 * reads a session back, or open on a session. A first turn asked while the conversation is closed opens it on the turn's
 * seqPath when the turn's step starts, and each turn of the conversation is appended when it ends, with how it ended.
 * `transcript` states the messages a view shows: the conversation's turns, and the page's turn where it is one of them,
 * with the turns off the branch the next question replies to hidden.
 *
 * The adapters raise the events. `openConversation` reads a session back and `closeConversation` leaves it; both clear
 * the actions bar's scope, whose turn is one of the session left. A subscription to the page's turn opens the
 * conversation on a first turn, activates the actions bar's scope with each comment a turn of the conversation records,
 * and appends each turn that ends. A subscription to the conversation writes its session to the view hash.
 */
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import type { TChatMessage } from "./components/shu-chat-message.js";
import { inFlight, turnRefusal, turnState, type TAskedTurn, type TTurnState } from "./chat-turn.js";
import { reportToRun } from "./client-log.js";
import { CONVERSATION_PARAM } from "./consts.js";
import { SCOPE, dispatchSubjectEvent } from "./current-subject.js";
import { conduit, reads } from "./hypermedia.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { SessionReadSchema, type TBundle, type TChatStatus, type TSessionTurn } from "./schemas.js";
import { SharedSignal } from "./signals.js";
import { appAccessLevel } from "./util.js";
import { mergeHashParams } from "./view-hash.js";

/** A turn of the conversation: as the store reads it back, or as it ended on this page, with how it ended. */
export type TConversationTurn = TSessionTurn & { status?: TChatStatus; error?: string; activity?: string[] };

export type TConversationState = { status: "closed" | "opening" | "open"; session: string | null; turns: TConversationTurn[] };

export type TConversationEvent =
	| { type: "open"; session: string }
	| { type: "opened"; session: string; turns: TSessionTurn[] }
	| { type: "failed"; session: string }
	| { type: "close" }
	| { type: "turnStarted"; seqPath: string }
	| { type: "turnEnded"; session: string; turn: TConversationTurn };
export type TConversationEventType = TConversationEvent["type"];
export const CONVERSATION_EVENTS = ["open", "opened", "failed", "close", "turnStarted", "turnEnded"] as const satisfies readonly TConversationEventType[];

export const CLOSED_CONVERSATION: TConversationState = { status: "closed", session: null, turns: [] };

/** The refusal of a question asked while the store reads the conversation back. */
export const CONVERSATION_OPENING = "the conversation is still opening; ask once its turns are shown";
/** What a reply shows before the turn states anything about itself. */
export const SENDING = "Sending...";
/** The key of a turn whose step has not started. One turn is in flight at a time, so one key serves. */
const PENDING = "pending";

/** The next state, for any state and any event. `opened` and `failed` apply only to the session being opened, so a read
 *  that returns after the reader moved on changes nothing. */
export function transition(conversation: TConversationState, event: TConversationEvent): TConversationState {
	switch (event.type) {
		case "open":
			return { status: "opening", session: event.session, turns: [] };
		case "opened":
			return conversation.status === "opening" && conversation.session === event.session ? { ...conversation, status: "open", turns: event.turns } : conversation;
		case "failed":
			return conversation.status === "opening" && conversation.session === event.session ? CLOSED_CONVERSATION : conversation;
		case "close":
			return conversation.status === "closed" ? conversation : CLOSED_CONVERSATION;
		case "turnStarted":
			return conversation.status === "closed" ? { status: "open", session: event.seqPath, turns: [] } : conversation;
		case "turnEnded":
			if (conversation.status !== "open" || conversation.session !== event.session) return conversation;
			return { ...conversation, turns: [...conversation.turns.filter((turn) => turn.seqPath !== event.turn.seqPath), event.turn] };
	}
}

/** Whether the page's turn is one of the conversation's: asked in its session, or its first turn. A first turn is one of
 *  a closed conversation until its step starts, and of the conversation it opened after. */
export function turnOfConversation(conversation: TConversationState, turn: TTurnState): boolean {
	if (turn.status === "idle") return false;
	if (turn.session !== undefined) return conversation.status !== "closed" && turn.session === conversation.session;
	return turn.seqPath === null ? conversation.status === "closed" : turn.seqPath === conversation.session;
}

/** Why a question cannot be asked now, or null when it can: a turn is in flight, or the conversation is still opening. */
export function askRefusal(conversation: TConversationState, turn: TTurnState): string | null {
	return turnRefusal(turn) ?? (conversation.status === "opening" ? CONVERSATION_OPENING : null);
}

/** A turn as the transcript shows it, keyed by its seqPath, or as pending before its step starts. */
type TShownTurn = Omit<TConversationTurn, "seqPath"> & { key: string; seqPath?: string; status: TChatStatus; shownBundle: TBundle };

/** The conversation's turns and the page's turn where it is one of them, not yet appended. */
function shownTurns(conversation: TConversationState, turn: TTurnState, accessLevel: string): TShownTurn[] {
	const shown: TShownTurn[] = conversation.turns.map((held) => ({
		...held,
		key: held.seqPath,
		status: held.status ?? "completed",
		shownBundle: { patterns: held.bundle, accessLevel },
	}));
	if (turn.status === "idle" || !turnOfConversation(conversation, turn) || shown.some((held) => held.seqPath === turn.seqPath)) return shown;
	return [...shown, { ...heldTurn(turn), key: turn.seqPath ?? PENDING, seqPath: turn.seqPath ?? undefined, status: turn.status, shownBundle: turn.bundle }];
}

/** The page's turn as the conversation holds it, but for the seqPath its step is named by. */
function heldTurn(turn: TAskedTurn): Omit<TConversationTurn, "seqPath"> {
	const [asked, answered] = turn.recorded;
	return {
		prompt: turn.prompt,
		response: turn.text,
		inReplyTo: turn.inReplyTo,
		askId: asked?.id,
		sayId: answered?.id,
		bundle: turn.bundle.patterns,
		status: turn.status,
		error: turn.error,
		activity: turn.activity,
	};
}

/**
 * The turns on the branch the transcript shows, and the other branch that leaves each of them. The branch runs from the
 * session's first turn to `onTurn`, then along the newest reply below it to a leaf. Unset or unknown, `onTurn` is the
 * newest turn. Where a turn on the branch has replies off it, the newest other branch is offered by its latest answer.
 */
function branch(turns: TShownTurn[], onTurn: string | undefined): { onPath: Set<string>; others: Map<string, NonNullable<TChatMessage["otherBranch"]>> } {
	const byKey = new Map(turns.map((turn) => [turn.key, turn]));
	const childrenOf = new Map<string, string[]>();
	for (const turn of turns) if (turn.inReplyTo !== undefined && byKey.has(turn.inReplyTo)) childrenOf.set(turn.inReplyTo, [...(childrenOf.get(turn.inReplyTo) ?? []), turn.key]);
	const newestLeafBelow = (key: string): string => {
		let at = key;
		for (let children = childrenOf.get(at); children?.length; children = childrenOf.get(at)) at = children[children.length - 1];
		return at;
	};
	const onPath = new Set<string>();
	const start = onTurn !== undefined && byKey.has(onTurn) ? onTurn : turns.at(-1)?.key;
	if (start === undefined) return { onPath, others: new Map() };
	for (let at: string | undefined = newestLeafBelow(start); at !== undefined && byKey.has(at) && !onPath.has(at); at = byKey.get(at)?.inReplyTo) onPath.add(at);
	const others = new Map<string, NonNullable<TChatMessage["otherBranch"]>>();
	for (const key of onPath) {
		const off = (childrenOf.get(key) ?? []).filter((child) => !onPath.has(child));
		const latest = off.length > 0 ? byKey.get(newestLeafBelow(off[off.length - 1])) : undefined;
		if (latest?.sayId && latest.seqPath) others.set(key, { recordId: latest.sayId, seqPath: latest.seqPath, bundle: latest.shownBundle, count: off.length });
	}
	return { onPath, others };
}

export type TTranscriptEntry = { message: TChatMessage; shown: boolean };

/**
 * The messages a transcript shows, in order: each turn's question and answer, keyed by the turn. Every turn's messages
 * are listed, so a view keeps each message where it first appeared; the turns off the branch `onTurn` is on are not
 * shown. The answer where another branch leaves carries that branch.
 */
export function transcript(conversation: TConversationState, turn: TTurnState, onTurn: string | undefined, accessLevel: string): TTranscriptEntry[] {
	const turns = shownTurns(conversation, turn, accessLevel);
	const { onPath, others } = branch(turns, onTurn);
	return turns.flatMap((shownTurn): TTranscriptEntry[] => {
		const { key, seqPath, inReplyTo, shownBundle: bundle, status, activity = [] } = shownTurn;
		const shown = onPath.has(key);
		const running = inFlight(status);
		const otherBranch = others.get(key);
		const common = { seqPath, inReplyTo, bundle, spinnerSpinning: running, error: "" };
		return [
			{ shown, message: { ...common, id: `${key}:ask`, role: "user", text: shownTurn.prompt, recordId: shownTurn.askId, activity: [], spinnerStatus: "", spinnerVisible: false } },
			{
				shown,
				message: {
					...common,
					id: `${key}:say`,
					role: "llm",
					text: shownTurn.response,
					status,
					recordId: shownTurn.sayId,
					activity,
					spinnerStatus: activity.at(-1) ?? SENDING,
					spinnerVisible: running,
					error: shownTurn.error ?? "",
					...(otherBranch ? { otherBranch } : {}),
				},
			},
		];
	});
}

/** The one instance, shared across every component and bundle. */
export const conversationState = new SharedSignal<TConversationState>("conversation", CLOSED_CONVERSATION);

/** The only writer: raise an event, and every reader of the conversation sees the next state. */
export function dispatchConversationEvent(event: TConversationEvent): TConversationState {
	const next = transition(conversationState.get(), event);
	conversationState.set(next);
	return next;
}

/**
 * Open the conversation on a session and read its turns back. While the session is read, the actions bar's scope holds
 * no turn. Its last answer then raises `answer` on the scope: `update` for a page coming back to the conversation its
 * address names, `activate` for a reader who picked the session. A read that fails closes the conversation and is
 * reported to the run.
 */
export async function openConversation(session: string, answer: "activate" | "update"): Promise<void> {
	dispatchConversationEvent({ type: "open", session });
	dispatchSubjectEvent({ type: "clear", scope: SCOPE.actionsBar });
	try {
		await getAvailableSteps();
		const read = SessionReadSchema.parse(await conduit().follow(reads(requireStep("loadChatSession"), { sessionSeqPath: session }), "conversation: read a session back"));
		const opened = dispatchConversationEvent({ type: "opened", session, turns: read.turns });
		const last = read.turns.at(-1);
		if (opened.status !== "open" || opened.session !== session || !last?.sayId) return;
		const entry = { record: { id: last.sayId, label: COMMENT_LABEL }, seqPath: last.seqPath, bundle: { patterns: last.bundle, accessLevel: appAccessLevel() } };
		dispatchSubjectEvent({ type: answer, scope: SCOPE.actionsBar, entry });
	} catch (err) {
		dispatchConversationEvent({ type: "failed", session });
		reportToRun("error", "conversation", `the conversation ${session} was not read back: ${errorDetail(err)}`);
	}
}

/** Leave the conversation, so the next question starts a session. The actions bar's scope holds no turn after it. */
export function closeConversation(): void {
	dispatchConversationEvent({ type: "close" });
	dispatchSubjectEvent({ type: "clear", scope: SCOPE.actionsBar });
}

/** Follow one move of the page's turn: a first turn whose step started opens a closed conversation, a comment a turn of
 *  the conversation recorded activates the actions bar's scope, and a turn that ended is appended to its session. */
function followTurn(turn: TTurnState, before: TTurnState): void {
	if (turn.status === "idle" || before.status === "idle") return;
	if (turn.status === "running" && before.status === "asking" && turn.seqPath && turn.session === undefined)
		dispatchConversationEvent({ type: "turnStarted", seqPath: turn.seqPath });
	const record = turn.recorded.at(-1);
	if (
		turn.status === "running" &&
		before.status === "running" &&
		record &&
		turn.recorded.length > before.recorded.length &&
		turn.seqPath &&
		turnOfConversation(conversationState.get(), turn)
	) {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: { record, seqPath: turn.seqPath, bundle: turn.bundle } });
	}
	if (inFlight(before.status) && !inFlight(turn.status) && turn.seqPath) {
		dispatchConversationEvent({ type: "turnEnded", session: turn.session ?? turn.seqPath, turn: { ...heldTurn(turn), seqPath: turn.seqPath } });
	}
}

let lastTurn = turnState.get();
turnState.subscribe((turn) => {
	const before = lastTurn;
	lastTurn = turn;
	followTurn(turn, before);
});

let addressed = conversationState.get().session;
conversationState.subscribe((conversation) => {
	if (conversation.session === addressed) return;
	addressed = conversation.session;
	mergeHashParams({ [CONVERSATION_PARAM]: conversation.session ?? "" });
});
