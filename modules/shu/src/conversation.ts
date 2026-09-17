/**
 * The conversation the ask is open on, and the turn this page asks, held as one state that events move.
 *
 * A conversation is a session: the turns grouped under a first turn, each turn named by its question's record. It is
 * closed, opening while the store reads a session back, or open on a session. A conversation opened by a first question
 * is open on no session until the run records that question, which then names it.
 *
 * The turn this page asks is asked, starts when the run names its step, streams its text, its status lines and the
 * comments it records, and ends as completed, failed or stopped. One is in flight at a time, whatever conversation is
 * open, so it runs on when the reader opens another, and a pane that closes does not end it. While it is one of the open
 * conversation's turns, every move of it is written into the conversation's turns in its place. A read of the session
 * keeps the page's copy while the turn is in flight, and the store's once it has ended.
 *
 * `transition` states each move, and an event outside those moves leaves the state unchanged. Adapters raise the events:
 * `startTurn` (chat-turn.ts) from the request stream, `openConversation` and `closeConversation` from the reader, and
 * `followRunningTurns` from the run's stream, which reads the session again when a turn another page asks may have
 * ended. Followers write the session to the view hash and activate the actions bar's scope with each comment the page's
 * turn records in the open conversation. `transcript` states the messages a view shows.
 */
import { COMMENT_LABEL, type AccessQueryLevel } from "@haibun/core/lib/resources.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import type { TChatMessage } from "./components/shu-chat-message.js";
import { reportToRun } from "./client-log.js";
import { CONVERSATION_PARAM } from "./consts.js";
import { SCOPE, dispatchSubjectEvent, type TRecord } from "./current-subject.js";
import { subscribeBatchedEvents, type TEvent } from "./event-stream.js";
import { conduit, reads } from "./hypermedia.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { SessionReadSchema, type TBundle, type TChatStatus, type TContextPattern, type TSessionTurn } from "./schemas.js";
import { SharedMachine, SharedSignal } from "./signals.js";
import { appAccessLevel } from "./util.js";
import { mergeHashParams } from "./view-hash.js";

/** The step a turn runs. */
export const ASK_STEP = "chatWithContext";

/** A turn: as the store reads it back, or as this page asks it, with what it stated while it ran. Its question's record
 *  names it, and a turn this page asks is named by none until the run records that question. */
export type TTurn = Omit<TSessionTurn, "askId" | "error"> & { askId: string | null; error: string; activity: string[] };

/** The turn this page asks: the turn, the session it was asked in, and the reason a reader gave to stop it. The session
 *  is null for a first turn until its question is recorded. */
export type TAskedTurn = TTurn & { session: string | null; stoppedBy: string };

export type TConversationState = {
	status: "closed" | "opening" | "open";
	session: string | null;
	turns: TTurn[];
	/** The turn this page asked last, in flight or ended; null before the page asks. */
	asked: TAskedTurn | null;
};

export type TConversationEvent =
	| { type: "open"; session: string }
	| { type: "read"; session: string; turns: TSessionTurn[] }
	| { type: "failed"; session: string }
	| { type: "close" }
	| { type: "ask"; prompt: string; patterns: TContextPattern[]; session?: string; inReplyTo?: string }
	| { type: "started" }
	| { type: "text"; piece: string }
	| { type: "status"; line: string }
	| { type: "recorded"; record: TRecord }
	| { type: "stop"; reason: string }
	| { type: "ended" }
	| { type: "erred"; message: string };
export type TConversationEventType = TConversationEvent["type"];
/** The events a turn's request raises, which move the page's turn whatever conversation is open. */
export const REQUEST_EVENTS = ["started", "text", "status", "recorded", "stop", "ended", "erred"] as const satisfies readonly TConversationEventType[];
type TRequestEvent = Extract<TConversationEvent, { type: (typeof REQUEST_EVENTS)[number] }>;
export const CONVERSATION_EVENTS = [
	"open",
	"read",
	"failed",
	"close",
	"ask",
	"started",
	"text",
	"status",
	"recorded",
	"stop",
	"ended",
	"erred",
] as const satisfies readonly TConversationEventType[];

export const CLOSED_CONVERSATION: TConversationState = { status: "closed", session: null, turns: [], asked: null };

/** The refusal of a question asked while a turn is in flight. */
export const TURN_IN_FLIGHT = "a turn is running; wait for it to answer or stop it";
/** The refusal of a question asked while the store reads the conversation back. */
export const CONVERSATION_OPENING = "the conversation is still opening; ask once its turns are shown";
/** The error of a turn whose stream ended before the run started its step. */
export const NOT_STARTED = "the stream ended before the run started the turn's step";
/** What a reply shows before the turn states anything about itself. */
export const SENDING = "Sending...";
/** The key of a turn whose question the run has not recorded. A question replaces such a turn, so one key serves. */
const PENDING = "pending";

/** Whether a turn with the status was asked and has not ended. No status is not in flight. */
export function inFlight(status: TChatStatus | undefined): boolean {
	return status === "asking" || status === "running";
}

/** Whether a turn ended between two of its statuses. */
export function turnEnded(before: TChatStatus | undefined, after: TChatStatus | undefined): boolean {
	return inFlight(before) && !inFlight(after);
}

/** Why a question cannot be asked now, or null when it can: a turn is in flight, or the conversation is still opening. */
export function askRefusal(conversation: TConversationState): string | null {
	if (inFlight(conversation.asked?.status)) return TURN_IN_FLIGHT;
	return conversation.status === "opening" ? CONVERSATION_OPENING : null;
}

/** Whether the page's turn is one of the open conversation's: asked in its session, or the first turn of a conversation
 *  its question opened. */
function asksIn(conversation: TConversationState): boolean {
	return conversation.status === "open" && conversation.asked !== null && conversation.asked.session === conversation.session;
}

/** The turn as the conversation holds it, without what only the page's request holds. */
export function turnOf({ session: _session, stoppedBy: _stoppedBy, ...turn }: TAskedTurn): TTurn {
	return turn;
}

/** The conversation with the page's turn written into its turns in its place, where it is one of them. Its place is its
 *  question's, or the turn no question names yet, which only the page's turn is, since a question replaces one. */
function withAsked(conversation: TConversationState): TConversationState {
	const { asked } = conversation;
	if (!asked || !asksIn(conversation)) return conversation;
	const at = conversation.turns.findIndex((turn) => turn.askId === asked.askId || turn.askId === null);
	const turns = at === -1 ? [...conversation.turns, turnOf(asked)] : conversation.turns.map((turn, index) => (index === at ? turnOf(asked) : turn));
	return { ...conversation, turns };
}

/** The page's turn after a request event, or the turn unchanged where the event does not move it. */
function movedAsked(asked: TAskedTurn, event: TRequestEvent): TAskedTurn {
	if (!inFlight(asked.status)) return asked;
	const running = asked.status === "running";
	switch (event.type) {
		case "started":
			return running ? asked : { ...asked, status: "running" };
		case "text":
			return running ? { ...asked, response: asked.response + event.piece } : asked;
		case "status":
			return running ? { ...asked, activity: [...asked.activity, event.line] } : asked;
		case "recorded":
			// The run records the question first, which names the turn, and the answer after it.
			if (!running) return asked;
			return asked.askId === null ? { ...asked, askId: event.record.id, session: asked.session ?? event.record.id } : { ...asked, sayId: event.record.id };
		case "stop":
			return asked.stoppedBy ? asked : { ...asked, stoppedBy: event.reason };
		case "ended":
			return running ? { ...asked, status: "completed" } : { ...asked, status: "failed", error: NOT_STARTED };
		case "erred":
			return asked.stoppedBy ? { ...asked, status: "stopped", error: `${asked.stoppedBy}: ${event.message}` } : { ...asked, status: "failed", error: event.message };
	}
}

/**
 * The next state, for any state and any event.
 *
 * `read` applies only to the session being opened or open, so a read that returns after the reader moved on changes
 * nothing, and a turn it reads keeps what the page stated of it while it ran, which the store does not hold. `failed`
 * applies only to the session being opened. `ask` is refused while a turn is in flight or the conversation opens, and
 * replaces a turn the run never recorded; asked in a closed conversation, it opens one on no session. The page's turn
 * moves on its request's events whatever conversation is open, and the first record of a first turn names the
 * conversation it opened.
 */
export function transition(conversation: TConversationState, event: TConversationEvent): TConversationState {
	const { asked } = conversation;
	switch (event.type) {
		case "open":
			return { ...conversation, status: "opening", session: event.session, turns: [] };
		case "read": {
			if (conversation.status === "closed" || conversation.session !== event.session) return conversation;
			const held = new Map(conversation.turns.map((turn) => [turn.askId, turn]));
			const turns = event.turns.map((turn) => ({ ...turn, error: turn.error ?? "", activity: held.get(turn.askId)?.activity ?? [] }));
			const read = { ...conversation, status: "open" as const, turns };
			// The store's copy of the page's turn is the newer once the turn has ended, and until then the page's is.
			return !inFlight(asked?.status) && event.turns.some((turn) => turn.askId === asked?.askId) ? read : withAsked(read);
		}
		case "failed":
			return conversation.status === "opening" && conversation.session === event.session ? { ...CLOSED_CONVERSATION, asked } : conversation;
		case "close":
			return conversation.status === "closed" ? conversation : { ...CLOSED_CONVERSATION, asked };
		case "ask": {
			if (askRefusal(conversation)) return conversation;
			const { prompt, patterns, inReplyTo } = event;
			const next: TAskedTurn = {
				askId: null,
				prompt,
				response: "",
				bundle: patterns,
				...(inReplyTo ? { inReplyTo } : {}),
				status: "asking",
				error: "",
				activity: [],
				session: event.session ?? null,
				stoppedBy: "",
			};
			const opened = conversation.status === "closed" ? { status: "open" as const, session: null } : {};
			return withAsked({ ...conversation, ...opened, turns: conversation.turns.filter((turn) => turn.askId !== null), asked: next });
		}
		default: {
			if (!asked) return conversation;
			const moved = movedAsked(asked, event);
			if (moved === asked) return conversation;
			const named = asksIn(conversation) && conversation.session === null && moved.session !== null;
			return withAsked({ ...conversation, ...(named ? { session: moved.session } : {}), asked: moved });
		}
	}
}

/** A turn as the transcript shows it, keyed by its question's record, or as pending before the run records it, with the
 *  bundle its messages carry. */
type TShownTurn = Omit<TTurn, "bundle"> & { key: string; bundle: TBundle };

/**
 * The turns on the branch the transcript shows, and the other branch that leaves each of them. The branch runs from the
 * session's first turn to `onTurn`, then along the newest reply below it to a leaf. Unset or unknown, `onTurn` is the
 * newest turn. Where a turn on the branch has replies off it, the newest other branch is offered by its latest answer,
 * or by its question where the turn ended with no answer recorded.
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
		if (latest?.askId) others.set(key, { recordId: latest.sayId ?? latest.askId, turn: latest.askId, bundle: latest.bundle, count: off.length });
	}
	return { onPath, others };
}

type TTranscriptEntry = { message: TChatMessage; shown: boolean };

/**
 * The messages a transcript shows, in order: each turn's question and answer, keyed by the turn. Every turn's messages
 * are listed, so a view keeps each message where it first appeared; the turns off the branch `onTurn` is on are not
 * shown. The answer where another branch leaves carries that branch.
 */
export function transcript(conversation: TConversationState, onTurn: string | undefined, accessLevel: AccessQueryLevel): TTranscriptEntry[] {
	const turns = conversation.turns.map((turn) => ({ ...turn, key: turn.askId ?? PENDING, bundle: { patterns: turn.bundle, accessLevel } }));
	const { onPath, others } = branch(turns, onTurn);
	return turns.flatMap((turn): TTranscriptEntry[] => {
		const { key, askId, inReplyTo, status, activity } = turn;
		const shown = onPath.has(key);
		const running = inFlight(status);
		const otherBranch = others.get(key);
		const common = { turn: askId ?? undefined, inReplyTo, bundle: turn.bundle, spinnerSpinning: running, error: "" };
		return [
			{ shown, message: { ...common, id: `${key}:ask`, role: "user", text: turn.prompt, recordId: askId ?? undefined, activity: [], spinnerStatus: "", spinnerVisible: false } },
			{
				shown,
				message: {
					...common,
					id: `${key}:say`,
					role: "llm",
					text: turn.response,
					status,
					recordId: turn.sayId,
					activity,
					spinnerStatus: activity.at(-1) ?? SENDING,
					spinnerVisible: running,
					error: turn.error,
					...(otherBranch ? { otherBranch } : {}),
				},
			},
		];
	});
}

/** The question the reader is writing, held for the page, so it stays while the ask pane closes and opens again and while
 *  the actions bar changes mode. */
export const askDraft = new SharedSignal<string>("askDraft", "");

/** The one instance, shared across every component and bundle. */
export const conversationMachine = new SharedMachine<TConversationState, TConversationEvent>("conversation", CLOSED_CONVERSATION, transition);
export const conversationState = conversationMachine.state;
export const dispatchConversationEvent = (event: TConversationEvent): TConversationState => conversationMachine.dispatch(event);

/** A session's turns, as the store reads them back. */
async function readSession(session: string): Promise<TSessionTurn[]> {
	await getAvailableSteps();
	return SessionReadSchema.parse(await conduit().follow(reads(requireStep("loadChatSession"), { session }), "conversation: read a session back")).turns;
}

/**
 * Open the conversation on a session and read its turns back. While the session is read, the actions bar's scope holds
 * no turn. Its latest turn then raises `answer` on the scope, with its answer where it has one: `update` for a page
 * coming back to the conversation its address names, `activate` for a reader who picked the session. Only the read that
 * opened the conversation does: a read that returns after the reader moved on, or after another read opened it, moves
 * nothing on the scope, so it does not replace what the reader selected since. A read that fails closes the conversation
 * and is reported to the run.
 */
export async function openConversation(session: string, answer: "activate" | "update"): Promise<void> {
	dispatchConversationEvent({ type: "open", session });
	dispatchSubjectEvent({ type: "clear", scope: SCOPE.actionsBar });
	try {
		const turns = await readSession(session);
		const before = conversationState.get();
		const latest = dispatchConversationEvent({ type: "read", session, turns }).turns.at(-1);
		if (before.status !== "opening" || before.session !== session || !latest?.askId) return;
		const entry = { record: { id: latest.sayId ?? latest.askId, label: COMMENT_LABEL }, turn: latest.askId, bundle: { patterns: latest.bundle, accessLevel: appAccessLevel() } };
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

/** Whether an event on the run's stream is the end of a turn's step. */
const endsATurn = (event: TEvent): boolean => event.kind === "lifecycle" && event.type === "step" && event.stage === "end" && event.actionName === ASK_STEP;

/**
 * Follow the run's stream for the end of a turn the open conversation holds running that this page does not ask. Such a
 * turn ends on another page's request, or on this page's before it loaded, so its end reaches this page on no request
 * of its own. The session is read again when the stream reports a turn's step ended, and when the stream comes back
 * after a break, since what ended during it reached no page. A read raises `read` only while the conversation is still
 * open on the session, so it never opens one. A read that fails is reported, and the turn stays as it was read.
 * Returns what ends the following.
 */
export function followRunningTurns(): () => void {
	// One read at a time: a turn that ends while a read is out is read by one more read once that one returns.
	let reading = false;
	let endedMeanwhile = false;
	const readAgain = (): void => {
		const { status, session, turns, asked } = conversationState.get();
		const elsewhere = turns.some((turn) => inFlight(turn.status) && !(inFlight(asked?.status) && turn.askId === asked?.askId));
		if (status !== "open" || session === null || !elsewhere) return;
		if (reading) {
			endedMeanwhile = true;
			return;
		}
		reading = true;
		readSession(session)
			.then(
				(read) => {
					const now = conversationState.get();
					if (now.status === "open" && now.session === session) dispatchConversationEvent({ type: "read", session, turns: read });
				},
				(err) => reportToRun("error", "conversation", `the conversation ${session} was not read again: ${errorDetail(err)}`),
			)
			.finally(() => {
				reading = false;
				if (!endedMeanwhile) return;
				endedMeanwhile = false;
				readAgain();
			});
	};
	return subscribeBatchedEvents({ filter: endsATurn, onBatch: readAgain, onReconnect: readAgain });
}

/** Follow each move: a comment the page's turn records in the open conversation activates the actions bar's scope, and
 *  the session is written to the view hash. A conversation still opening is not activated by its turn's comments: the
 *  read that opens it activates its latest turn. */
conversationMachine.follow(({ event, before, after }) => {
	if (event.type === "recorded" && after.asked?.askId && after.asked !== before.asked && asksIn(after)) {
		const entry = { record: event.record, turn: after.asked.askId, bundle: { patterns: after.asked.bundle, accessLevel: appAccessLevel() } };
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry });
	}
	if (after.session !== before.session) mergeHashParams({ [CONVERSATION_PARAM]: after.session ?? "" });
});
