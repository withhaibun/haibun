/**
 * The conversation the ask is open on, held as one state that events move.
 *
 * A conversation is a session: the turns grouped under a first turn, each turn named by its question's record. It is
 * closed, opening while the store reads a session back, or open on a session. A first turn asked while the conversation
 * is closed opens it on the turn's question once the run records that question, so a turn the run refused before it
 * recorded anything opens nothing. Each turn of the conversation is appended when it ends, with how it ended.
 * `transcript` states the messages a view shows: the conversation's turns, with the page's turn in place of any copy of
 * it the store read back, and the turns off the branch the next question replies to hidden.
 *
 * The adapters raise the events. `openConversation` reads a session back and `closeConversation` leaves it; both clear
 * the actions bar's scope, whose turn is one of the session left. A follower of the page's turn opens the conversation on
 * a first turn's question, activates the actions bar's scope with each comment a turn of the open conversation records,
 * and appends each turn that ends. A follower of the conversation writes its session to the view hash.
 */
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import type { TChatMessage } from "./components/shu-chat-message.js";
import { inFlight, turnEnded, turnMachine, turnRefusal, type TAskedTurn, type TTurnState } from "./chat-turn.js";
import { reportToRun } from "./client-log.js";
import { CONVERSATION_PARAM } from "./consts.js";
import { SCOPE, dispatchSubjectEvent } from "./current-subject.js";
import { conduit, reads } from "./hypermedia.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { SessionReadSchema, type TBundle, type TSessionTurn } from "./schemas.js";
import { SharedMachine } from "./signals.js";
import { appAccessLevel } from "./util.js";
import { mergeHashParams } from "./view-hash.js";

/** A turn of the conversation: as the store reads it back, or as it ended on this page, with what it stated while it ran. */
export type TConversationTurn = TSessionTurn & { activity?: string[] };

export type TConversationState = { status: "closed" | "opening" | "open"; session: string | null; turns: TConversationTurn[] };

export type TConversationEvent =
	| { type: "open"; session: string }
	| { type: "opened"; session: string; turns: TSessionTurn[] }
	| { type: "failed"; session: string }
	| { type: "close" }
	| { type: "turnAsked"; turn: string }
	| { type: "turnEnded"; session: string; turn: TConversationTurn };
export type TConversationEventType = TConversationEvent["type"];
export const CONVERSATION_EVENTS = ["open", "opened", "failed", "close", "turnAsked", "turnEnded"] as const satisfies readonly TConversationEventType[];

export const CLOSED_CONVERSATION: TConversationState = { status: "closed", session: null, turns: [] };

/** The refusal of a question asked while the store reads the conversation back. */
export const CONVERSATION_OPENING = "the conversation is still opening; ask once its turns are shown";
/** What a reply shows before the turn states anything about itself. */
export const SENDING = "Sending...";
/** The key of a turn whose question the run has not recorded. One turn is in flight at a time, so one key serves. */
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
		case "turnAsked":
			return conversation.status === "closed" ? { status: "open", session: event.turn, turns: [] } : conversation;
		case "turnEnded":
			if (conversation.status !== "open" || conversation.session !== event.session) return conversation;
			return { ...conversation, turns: [...conversation.turns.filter((turn) => turn.askId !== event.turn.askId), event.turn] };
	}
}

/** Whether the page's turn is one of the conversation's: asked in its session, or its first turn. A first turn is one of
 *  a closed conversation until the run records its question, and of the conversation that question opened after. */
export function turnOfConversation(conversation: TConversationState, turn: TTurnState): boolean {
	if (turn.status === "idle") return false;
	if (turn.session !== undefined) return conversation.status !== "closed" && turn.session === conversation.session;
	return turn.turn === null ? conversation.status === "closed" : turn.turn === conversation.session;
}

/** Why a question cannot be asked now, or null when it can: a turn is in flight, or the conversation is still opening. */
export function askRefusal(conversation: TConversationState, turn: TTurnState): string | null {
	return turnRefusal(turn) ?? (conversation.status === "opening" ? CONVERSATION_OPENING : null);
}

/** A turn as the transcript shows it, keyed by its question's record, or as pending before the run records it, with
 *  the bundle its messages carry. */
type TShownTurn = Omit<TConversationTurn, "askId" | "bundle"> & { key: string; askId?: string; bundle: TBundle };

/** The conversation's turns, and the page's turn where it is one of them. The page's turn is newer than any copy of it
 *  the store read back, so it stands in that copy's place: a session read back while its turn runs shows the turn
 *  running, and the answer it ends with. */
function shownTurns(conversation: TConversationState, turn: TTurnState, accessLevel: string): TShownTurn[] {
	const live = turn.status !== "idle" && turnOfConversation(conversation, turn) ? turn : null;
	const shown: TShownTurn[] = conversation.turns
		.filter((held) => held.askId !== live?.turn)
		.map((held) => ({ ...held, key: held.askId, bundle: { patterns: held.bundle, accessLevel } }));
	if (!live) return shown;
	return [...shown, { ...heldTurn(live), key: live.turn ?? PENDING, askId: live.turn ?? undefined, bundle: live.bundle }];
}

/** The page's turn as the conversation holds it, but for the question record that names it. */
function heldTurn(turn: TAskedTurn): Omit<TConversationTurn, "askId"> {
	const answered = turn.recorded[1];
	return {
		prompt: turn.prompt,
		response: turn.text,
		...(turn.inReplyTo ? { inReplyTo: turn.inReplyTo } : {}),
		...(answered ? { sayId: answered.id } : {}),
		bundle: turn.bundle.patterns,
		status: turn.status,
		...(turn.error ? { error: turn.error } : {}),
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
		if (latest?.sayId && latest.askId) others.set(key, { recordId: latest.sayId, turn: latest.askId, bundle: latest.bundle, count: off.length });
	}
	return { onPath, others };
}

type TTranscriptEntry = { message: TChatMessage; shown: boolean };

/**
 * The messages a transcript shows, in order: each turn's question and answer, keyed by the turn. Every turn's messages
 * are listed, so a view keeps each message where it first appeared; the turns off the branch `onTurn` is on are not
 * shown. The answer where another branch leaves carries that branch.
 */
export function transcript(conversation: TConversationState, turn: TTurnState, onTurn: string | undefined, accessLevel: string): TTranscriptEntry[] {
	const turns = shownTurns(conversation, turn, accessLevel);
	const { onPath, others } = branch(turns, onTurn);
	return turns.flatMap((shownTurn): TTranscriptEntry[] => {
		const { key, askId, inReplyTo, bundle, status, activity = [] } = shownTurn;
		const shown = onPath.has(key);
		const running = inFlight(status);
		const otherBranch = others.get(key);
		const common = { turn: askId, inReplyTo, bundle, spinnerSpinning: running, error: "" };
		return [
			{ shown, message: { ...common, id: `${key}:ask`, role: "user", text: shownTurn.prompt, recordId: askId, activity: [], spinnerStatus: "", spinnerVisible: false } },
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
const conversationMachine = new SharedMachine<TConversationState, TConversationEvent>("conversation", CLOSED_CONVERSATION, transition);
export const conversationState = conversationMachine.state;
export const dispatchConversationEvent = (event: TConversationEvent): TConversationState => conversationMachine.dispatch(event);

/**
 * Open the conversation on a session and read its turns back. While the session is read, the actions bar's scope holds
 * no turn. Its last turn then raises `answer` on the scope, with its answer where it has one: `update` for a page
 * coming back to the conversation its address names, `activate` for a reader who picked the session. Only the read that
 * opened the conversation does: a read that returns after the reader moved on, or after another read opened it, moves
 * nothing, so it does not replace what the reader selected since. A read that fails closes the conversation and is
 * reported to the run.
 */
export async function openConversation(session: string, answer: "activate" | "update"): Promise<void> {
	dispatchConversationEvent({ type: "open", session });
	dispatchSubjectEvent({ type: "clear", scope: SCOPE.actionsBar });
	try {
		await getAvailableSteps();
		const read = SessionReadSchema.parse(await conduit().follow(reads(requireStep("loadChatSession"), { session }), "conversation: read a session back"));
		const before = conversationState.get();
		const last = read.turns.at(-1);
		if (dispatchConversationEvent({ type: "opened", session, turns: read.turns }) === before || !last) return;
		const entry = { record: { id: last.sayId ?? last.askId, label: COMMENT_LABEL }, turn: last.askId, bundle: { patterns: last.bundle, accessLevel: appAccessLevel() } };
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

/** Follow each move of the page's turn: the question of a first turn opens a closed conversation, a comment a turn of the
 *  open conversation records activates the actions bar's scope, and a turn that ended is appended to its session. A
 *  conversation still opening is not activated by its turn's comments: the read that opens it activates its last turn. */
turnMachine.follow(({ event, before, after }) => {
	if (after.status === "idle") return;
	if (event.type === "recorded") {
		if (before.status !== "idle" && before.turn === null && after.turn !== null && after.session === undefined) dispatchConversationEvent({ type: "turnAsked", turn: after.turn });
		const conversation = conversationState.get();
		if (after.turn !== null && conversation.status === "open" && turnOfConversation(conversation, after))
			dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: { record: event.record, turn: after.turn, bundle: after.bundle } });
	}
	if (turnEnded(before.status, after.status) && after.turn !== null)
		dispatchConversationEvent({ type: "turnEnded", session: after.session ?? after.turn, turn: { ...heldTurn(after), askId: after.turn } });
});

conversationMachine.follow(({ before, after }) => {
	if (after.session !== before.session) mergeHashParams({ [CONVERSATION_PARAM]: after.session ?? "" });
});
