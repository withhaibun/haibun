/**
 * One state holds the open conversation and the turn this page sends. Events change that state.
 *
 * A conversation is a session. A session groups turns under a first turn, and each turn's question record names the
 * turn. A conversation's status is closed, opening or open. It is opening while the store reads a session back. A first
 * question opens a conversation without a session. Actuality's record of that question then names the session.
 *
 * The page's turn has the status `asking` until actuality starts its step. Its status is then `running`. The request
 * stream carries the running turn's text, its status lines and the comments it records. The turn ends as completed,
 * failed or stopped. One turn of this page is in flight at a time, whatever conversation is open. The turn keeps running
 * when the reader opens another conversation. Closing a pane doesn't end it. Each change to the page's turn is written
 * into the open conversation's turns at its place, while that conversation contains the turn. A read of the session
 * keeps the page's copy of the turn while the turn is in flight. The read keeps the store's copy once the turn has ended.
 *
 * `transition` defines each move. An event outside those moves leaves the state unchanged. Adapters raise the events.
 * `startTurn` (chat-turn.ts) raises the request events from the request stream. `openConversation` and
 * `closeConversation` raise events for the reader's actions. `followRunningTurns` reads the session again when
 * actuality's stream reports a turn's step starting or ending. It raises a `read` event with the returned turns. A
 * follower writes the session to the view hash. It also activates the actions bar's scope with each comment and call
 * the page's turn records in the open conversation. `transcript` returns the messages a view shows.
 */
import { COMMENT_LABEL, type AccessQueryLevel } from "@haibun/core/lib/resources.js";
import type { TRefusedCall } from "@haibun/core/lib/step-stream-context.js";
import type { TCalled } from "@haibun/core/lib/called.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import type { TChatMessage } from "./page/components/shu-chat-message.js";
import { reportToRun } from "./client-log.js";
import { CONVERSATION_PARAM } from "./domains/elements.js";
import { SCOPE, dispatchSubjectEvent, recordOf, type TRecord } from "./current-subject.js";
import { hasEventStream, subscribeBatchedEvents, type TEvent } from "./event-stream.js";
import { conduit, reads } from "./hypermedia.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { SessionReadSchema, type TBundle, type TChatStatus, type TContextPattern, type TSessionTurn } from "./schemas.js";
import { SharedMachine, SharedSignal } from "./signals.js";
import { appAccessLevel } from "./util.js";
import { mergeHashParams } from "./view-hash.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

/** The step a turn runs. */
export const ASK_STEP = "chatWithContext";
/** The step that creates the key a turn acts as. The page signs a delegation to that key before it sends the turn, where
 *  the deployment verifies delegations. */
export const OPEN_TURN_STEP = "openTurn";
/** The step that stores a file a person adds to a question. The question then references the file. */
export const KEEP_FILE_STEP = "keepFile";

/** What a turn emitted while it ran. `progress` holds its latest status line, and its spinner shows that line.
 *  `context` holds the lines it sent, and `calls` holds the calls it made. */
export type TTurnStated = { progress: string; context: string[]; calls: TCalled[] };
const NOTHING_STATED: TTurnStated = { progress: "", context: [], calls: [] };

/** A turn as the store reads it back or as this page sends it, with what it emitted while it ran. Its question's record
 *  names it. A turn this page sends has a null `askId` until actuality records its question. */
export type TTurn = Omit<TSessionTurn, "askId" | "error"> & { askId: string | null; error: string } & TTurnStated;

/** The turn this page sends. It adds the turn's session, the reason a reader gave to stop it, the actions the page
 *  delegated to it, and each refused action with the first call that needed it. The session is null for a first turn
 *  until actuality records its question. */
export type TAskedTurn = TTurn & { session: string | null; stoppedBy: string; delegated: string[]; refused: TRefusedCall[] };

export type TConversationState = {
	status: "closed" | "opening" | "open";
	session: string | null;
	turns: TTurn[];
	/** The turn this page sent last, in flight or ended. It is null before the page sends a turn. */
	asked: TAskedTurn | null;
};

export type TConversationEvent =
	| { type: "open"; session: string }
	| { type: "read"; session: string; turns: TSessionTurn[] }
	| { type: "failed"; session: string }
	| { type: "close" }
	| { type: "ask"; prompt: string; patterns: TContextPattern[]; session?: string; inReplyTo?: string; delegated: string[] }
	| { type: "started" }
	| { type: "text"; piece: string }
	| { type: "status"; line: string }
	| { type: "context"; lines: string[] }
	| { type: "called"; calls: TCalled[] }
	| { type: "recorded"; record: TRecord }
	| { type: "refused"; call: TRefusedCall }
	| { type: "stop"; reason: string }
	| { type: "ended" }
	| { type: "erred"; message: string };
export type TConversationEventType = TConversationEvent["type"];
/** The events a turn's request raises. They move the page's turn whatever conversation is open. */
export const REQUEST_EVENTS = [
	"started",
	"text",
	"status",
	"context",
	"called",
	"recorded",
	"refused",
	"stop",
	"ended",
	"erred",
] as const satisfies readonly TConversationEventType[];
type TRequestEvent = Extract<TConversationEvent, { type: (typeof REQUEST_EVENTS)[number] }>;
/** Every event: the conversation's own events and its turn's request events. */
export const CONVERSATION_EVENTS = ["open", "read", "failed", "close", "ask", ...REQUEST_EVENTS] as const satisfies readonly TConversationEventType[];

export const CLOSED_CONVERSATION: TConversationState = { status: "closed", session: null, turns: [], asked: null };

/** The refusal of a question sent while a turn is in flight. */
export const TURN_IN_FLIGHT = "a turn is running; wait for its response or stop it";
/** The refusal of a question sent while the store reads the conversation back. */
export const CONVERSATION_OPENING = "the conversation is still opening; ask once its turns are shown";
/** The error of a turn whose stream ended before actuality started its step. */
export const NOT_STARTED = "the stream ended before actuality started the turn's step";
/** What a reply's spinner shows before the turn emits a status line. */
export const SENDING = "Sending...";
/** The key of a turn whose question actuality hasn't recorded. A new question replaces such a turn, so one key is enough. */
const PENDING = "pending";

/** Whether a turn with the status was sent and hasn't ended. A turn without a status isn't in flight. */
export function inFlight(status: TChatStatus | undefined): boolean {
	return status === "asking" || status === "running";
}

/** Whether a turn ended between two of its statuses. */
export function turnEnded(before: TChatStatus | undefined, after: TChatStatus | undefined): boolean {
	return inFlight(before) && !inFlight(after);
}

/** The refusal of a question sent now, or null. A question is refused while a turn is in flight or the conversation is opening. */
export function askRefusal(conversation: TConversationState): string | null {
	if (inFlight(conversation.asked?.status)) return TURN_IN_FLIGHT;
	return conversation.status === "opening" ? CONVERSATION_OPENING : null;
}

/** Whether the open conversation contains the page's turn. It contains a turn sent in its session, and the first turn
 *  whose question opened it. */
function asksIn(conversation: TConversationState): boolean {
	return conversation.status === "open" && conversation.asked !== null && conversation.asked.session === conversation.session;
}

/** The turn as the conversation holds it, without what only the page's request holds. */
export function turnOf({ session: _session, stoppedBy: _stoppedBy, delegated: _delegated, refused: _refused, ...turn }: TAskedTurn): TTurn {
	return turn;
}

/** Returns the conversation with the page's turn at its place in the turns, where the conversation contains the page's
 *  turn. Its place is the first turn with its question's id or with a null `askId`. Only the page's turn has a null
 *  `askId`, since a new question replaces such a turn. The page's turn is appended where the turns don't contain
 *  either. */
function withAsked(conversation: TConversationState): TConversationState {
	const { asked } = conversation;
	if (!asked || !asksIn(conversation)) return conversation;
	const at = conversation.turns.findIndex((turn) => turn.askId === asked.askId || turn.askId === null);
	const turns = at === -1 ? [...conversation.turns, turnOf(asked)] : conversation.turns.map((turn, index) => (index === at ? turnOf(asked) : turn));
	return { ...conversation, turns };
}

/** Returns the page's turn after a request event. Returns the turn unchanged where the event doesn't move it. */
function movedAsked(asked: TAskedTurn, event: TRequestEvent): TAskedTurn {
	if (!inFlight(asked.status)) return asked;
	const running = asked.status === "running";
	switch (event.type) {
		case "started":
			return running ? asked : { ...asked, status: "running" };
		case "text":
			return running ? { ...asked, response: asked.response + event.piece } : asked;
		case "status":
			return running ? { ...asked, progress: event.line } : asked;
		case "context":
			return running ? { ...asked, context: [...asked.context, ...event.lines] } : asked;
		case "called":
			return running ? { ...asked, calls: [...asked.calls, ...event.calls] } : asked;
		case "recorded":
			// Actuality records the question first, then the response. The question's record names the turn.
			if (!running) return asked;
			return asked.askId === null ? { ...asked, askId: event.record.id, session: asked.session ?? event.record.id } : { ...asked, sayId: event.record.id };
		case "refused":
			// A person allows a refused action once for every call that needs it, so the turn lists each refused action once.
			return running && !asked.refused.some((refused) => refused.action === event.call.action) ? { ...asked, refused: [...asked.refused, event.call] } : asked;
		case "stop":
			return asked.stoppedBy ? asked : { ...asked, stoppedBy: event.reason };
		case "ended":
			return running ? { ...asked, status: "completed" } : { ...asked, status: "failed", error: NOT_STARTED };
		case "erred":
			return asked.stoppedBy ? { ...asked, status: "stopped", error: `${asked.stoppedBy}: ${event.message}` } : { ...asked, status: "failed", error: event.message };
	}
}

/**
 * Returns the next state for any state and any event.
 *
 * `read` applies only to the session that is opening or open. A read that returns after the reader closed the
 * conversation or opened another session doesn't change the conversation. A turn the read returns keeps the context
 * lines and calls the page held for it, since the store doesn't hold them. `failed` applies only to the session that is
 * opening. `ask` is refused while a turn is in flight or the conversation is opening. It replaces a turn whose question
 * actuality didn't record. In a closed conversation it opens a conversation without a session. The page's turn moves on
 * its request's events whatever conversation is open. The first record of a first turn names the conversation that turn
 * opened.
 */
export function transition(conversation: TConversationState, event: TConversationEvent): TConversationState {
	const { asked } = conversation;
	switch (event.type) {
		case "open":
			return { ...conversation, status: "opening", session: event.session, turns: [] };
		case "read": {
			if (conversation.status === "closed" || conversation.session !== event.session) return conversation;
			const held = new Map(conversation.turns.map((turn) => [turn.askId, turn]));
			const turns = event.turns.map((turn) => {
				const { context, calls } = held.get(turn.askId) ?? NOTHING_STATED;
				return { ...turn, error: turn.error ?? "", progress: "", context, calls };
			});
			const read = { ...conversation, status: "open" as const, turns };
			// The store's copy of the page's turn is newer once the turn has ended. Until then the page's copy is newer.
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
				// Actuality's record of the turn supplies its time.
				generatedAtTime: "",
				...(inReplyTo ? { inReplyTo } : {}),
				status: "asking",
				error: "",
				...NOTHING_STATED,
				session: event.session ?? null,
				stoppedBy: "",
				delegated: event.delegated,
				refused: [],
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

/** A turn as the transcript shows it, with the bundle its messages carry. Its key is its question's record id, or
 *  `pending` before actuality records the question. */
type TShownTurn = Omit<TTurn, "bundle"> & { key: string; bundle: TBundle };

/** The parent key of a session's first questions. A conversation forks at its start as it forks at a turn. Another
 *  first question starts another branch of the same session. */
const START = "";

/**
 * Returns the turns on the branch the transcript shows, its first turn, and the other branch that leaves each turn on
 * it. The branch extends from the session's start to `onTurn`. Below `onTurn` it follows the newest reply to a leaf. An
 * unset or unknown `onTurn` selects the newest turn. The newest other branch is offered at each turn on the branch that
 * has replies off the branch. The offered branch references the response record of its newest leaf, or that leaf's
 * question record where the leaf doesn't have a recorded response. The other branch that leaves the start is keyed by
 * `START`.
 */
function branch(
	turns: TShownTurn[],
	onTurn: string | undefined,
): { onPath: Set<string>; first: string | undefined; others: Map<string, NonNullable<TChatMessage["otherBranch"]>> } {
	const byKey = new Map(turns.map((turn) => [turn.key, turn]));
	const childrenOf = new Map<string, string[]>();
	for (const turn of turns) {
		const parent = turn.inReplyTo !== undefined && byKey.has(turn.inReplyTo) ? turn.inReplyTo : START;
		childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), turn.key]);
	}
	const newestLeafBelow = (key: string): string => {
		let at = key;
		for (let children = childrenOf.get(at); children?.length; children = childrenOf.get(at)) at = itemAt(children, children.length - 1);
		return at;
	};
	const onPath = new Set<string>();
	let first: string | undefined;
	const start = onTurn !== undefined && byKey.has(onTurn) ? onTurn : turns.at(-1)?.key;
	if (start === undefined) return { onPath, first, others: new Map() };
	for (let at: string | undefined = newestLeafBelow(start); at !== undefined && byKey.has(at) && !onPath.has(at); at = byKey.get(at)?.inReplyTo) {
		onPath.add(at);
		first = at;
	}
	const others = new Map<string, NonNullable<TChatMessage["otherBranch"]>>();
	for (const key of [START, ...onPath]) {
		const off = (childrenOf.get(key) ?? []).filter((child) => !onPath.has(child));
		const latest = off.length > 0 ? byKey.get(newestLeafBelow(itemAt(off, off.length - 1))) : undefined;
		if (latest?.askId) others.set(key, { recordId: latest.sayId ?? latest.askId, turn: latest.askId, bundle: latest.bundle, count: off.length });
	}
	return { onPath, first, others };
}

/** One message of the transcript, whether the shown branch contains it, and the time its turn was sent. The timeline
 *  compares that time with the reader's place. */
type TTranscriptEntry = { message: TChatMessage; shown: boolean; askedAt: number | undefined };

/**
 * Returns the transcript's messages in order: each turn's question and response, keyed by the turn. Every turn's
 * messages are listed, so a view keeps each message where it first appeared. Turns off the branch that contains
 * `onTurn` aren't shown. The response where another branch leaves carries that branch. The first question shown
 * carries the branch that another first question of the session starts.
 */
export function transcript(conversation: TConversationState, onTurn: string | undefined, accessLevel: AccessQueryLevel): TTranscriptEntry[] {
	const turns = conversation.turns.map((turn) => ({ ...turn, key: turn.askId ?? PENDING, bundle: { patterns: turn.bundle, accessLevel } }));
	const { onPath, first, others } = branch(turns, onTurn);
	const otherFirst = others.get(START);
	return turns.flatMap((turn): TTranscriptEntry[] => {
		const { key, askId, inReplyTo, status, progress, context, calls } = turn;
		const shown = onPath.has(key);
		const asked = Date.parse(turn.generatedAtTime);
		const askedAt = Number.isFinite(asked) ? asked : undefined;
		const running = inFlight(status);
		const otherBranch = others.get(key);
		const common = { turn: askId ?? undefined, inReplyTo, bundle: turn.bundle, spinnerSpinning: running, error: "", unverified: [] as string[] };
		return [
			{
				shown,
				askedAt,
				message: {
					...common,
					id: `${key}:ask`,
					role: "user",
					text: turn.prompt,
					recordId: askId ?? undefined,
					context: [],
					calls: [],
					spinnerStatus: "",
					spinnerVisible: false,
					// The first question shown carries the branch that another first question starts.
					...(key === first && otherFirst ? { otherBranch: otherFirst } : {}),
				},
			},
			{
				shown,
				askedAt,
				message: {
					...common,
					id: `${key}:say`,
					role: "llm",
					text: turn.response,
					status,
					recordId: turn.sayId,
					context,
					calls,
					spinnerStatus: progress || SENDING,
					spinnerVisible: running,
					error: turn.error,
					unverified: turn.unverified ?? [],
					...(otherBranch ? { otherBranch } : {}),
				},
			},
		];
	});
}

/** The question the reader is writing. The page holds it while the ask pane closes and opens again, and while the
 *  actions bar changes mode. */
export const askDraft = new SharedSignal<string>("askDraft", "");

/** The conversation machine's one instance. Every component and bundle shares it. */
const conversationMachine = new SharedMachine<TConversationState, TConversationEvent>("conversation", CLOSED_CONVERSATION, transition);
export const conversationState = conversationMachine.state;
/** The stop reason of a turn the reader stopped. */
export const STOPPED_BY_THE_READER = "you stopped it";

export const dispatchConversationEvent = (event: TConversationEvent): TConversationState => conversationMachine.dispatch(event);

/**
 * The number of turns this page last read of each session, while the page is open.
 *
 * A session the reader opened counts as read. The list shows the number of turns each session gained since this page
 * last read it. A session this page hasn't read counts every turn as gained. A view reads the map as a signal, so
 * opening a session updates the list and clears that session's gained count.
 */
export const sessionsRead = new SharedSignal<Readonly<Record<string, number>>>("sessionsRead", {});

/** Records that this page has read a session's turns. */
function readTurnsOf(session: string, turns: number): void {
	if (sessionsRead.get()[session] === turns) return;
	sessionsRead.set({ ...sessionsRead.get(), [session]: turns });
}

/** How many turns a session gained since this page last read it. */
export function gainedSince(session: string, turns: number): number {
	return Math.max(0, turns - (sessionsRead.get()[session] ?? 0));
}

async function readSession(session: string): Promise<TSessionTurn[]> {
	await getAvailableSteps();
	return SessionReadSchema.parse(await conduit().follow(reads(requireStep("loadChatSession"), { session }), "conversation: read a session back")).turns;
}

/**
 * Opens the conversation on a session and reads its turns back. The actions bar's scope doesn't hold a turn while the
 * session is read. The event type that `answer` names is then raised on the scope with an entry for the latest turn.
 * The entry holds that turn's response record, else its question record. `answer` is `update` for a page that opens the
 * conversation its address names. It is `activate` for a reader who selected the session. Only the read that opened
 * the conversation raises the event. A read that returns after the reader closed the conversation or opened another
 * session doesn't change the scope. A read that returns after another read opened the conversation doesn't change the
 * scope either. The reader's later selection stays. A read that fails closes the conversation and is reported to
 * actuality.
 */
export async function openConversation(session: string, answer: "activate" | "update"): Promise<void> {
	dispatchConversationEvent({ type: "open", session });
	dispatchSubjectEvent({ type: "clear", scope: SCOPE.actionsBar });
	try {
		const turns = await readSession(session);
		readTurnsOf(session, turns.length);
		const before = conversationState.get();
		const latest = latestEntry(dispatchConversationEvent({ type: "read", session, turns }));
		if (before.status !== "opening" || before.session !== session || !latest) return;
		dispatchSubjectEvent({ type: answer, scope: SCOPE.actionsBar, entry: latest });
	} catch (err) {
		dispatchConversationEvent({ type: "failed", session });
		reportToRun("error", "conversation", `the conversation ${session} was not read back: ${errorDetail(err)}`);
	}
}

/** Closes the conversation, so the next question starts a session. Clears the actions bar's scope. */
export function closeConversation(): void {
	dispatchConversationEvent({ type: "close" });
	dispatchSubjectEvent({ type: "clear", scope: SCOPE.actionsBar });
}

/** Whether an event on actuality's stream reports a turn's step starting or ending. */
const reportsATurn = (event: TEvent): boolean => event.kind === "lifecycle" && event.type === "step" && event.actionName === ASK_STEP;

/** Calls `onReport` when actuality's stream reports a turn's step starting or ending, and when the stream reconnects.
 *  Any page can send the turn. A page that didn't send a turn reads a session's new turns this way. A page without an
 *  installed event stream doesn't receive reports and doesn't follow turns. Returns a function that stops following. */
export function followReportedTurns(onReport: () => void): () => void {
	if (!hasEventStream()) return () => undefined;
	return subscribeBatchedEvents({ filter: reportsATurn, onBatch: onReport, onReconnect: onReport });
}

/**
 * Follows actuality's stream for the turns of the open conversation, whichever page sent them. Another page's turn
 * starts and ends on that page's request, so this page doesn't request it. The session is read again when the stream
 * reports a turn's step starting or ending. It is also read again when the stream reconnects, since the page didn't
 * receive the events sent during the break. A read raises `read` only while the conversation is still open on the
 * session, so a read never opens a conversation. A failed read is reported, and the turns keep their last read state.
 * Returns a function that stops following.
 */
export function followRunningTurns(): () => void {
	// One read at a time. A report that arrives during a read causes one more read after that read returns.
	let reading = false;
	let reportedMeanwhile = false;
	const readAgain = (): void => {
		const { status, session } = conversationState.get();
		if (status !== "open" || session === null) return;
		if (reading) {
			reportedMeanwhile = true;
			return;
		}
		reading = true;
		readSession(session)
			.then(
				(read) => {
					const now = conversationState.get();
					if (now.status !== "open" || now.session !== session) return;
					readTurnsOf(session, read.length);
					dispatchConversationEvent({ type: "read", session, turns: read });
				},
				(err) => reportToRun("error", "conversation", `the conversation ${session} was not read again: ${errorDetail(err)}`),
			)
			.finally(() => {
				reading = false;
				if (!reportedMeanwhile) return;
				reportedMeanwhile = false;
				readAgain();
			});
	};
	return followReportedTurns(readAgain);
}

/** The actions bar's entry for a record of the turn `askId` names. Its bundle holds the patterns the turn's question references. */
const entryIn = (record: TRecord, askId: string, patterns: TContextPattern[]) => ({ record, turn: askId, bundle: { patterns, accessLevel: appAccessLevel() } });

/** The entry for the newest record of a conversation's latest turn: its response where it has one, else its question. */
function latestEntry(conversation: TConversationState) {
	const latest = conversation.turns.at(-1);
	return latest?.askId ? entryIn({ id: latest.sayId ?? latest.askId, label: COMMENT_LABEL }, latest.askId, latest.bundle) : null;
}

/** Follows each move so the actions bar's scope holds the conversation's newest record. It activates each comment and
 *  each call the page's turn records in the open conversation. It activates the newest comment of another page's turn
 *  once a read returns it. It writes the session to the view hash. A turn's records don't activate a conversation that
 *  is still opening, since the read that opens it activates its latest turn. */
conversationMachine.follow(({ event, before, after }) => {
	const { asked } = after;
	const reached = event.type === "recorded" ? event.record : event.type === "called" ? event.calls.map((call) => recordOf(call.record)).at(-1) : undefined;
	if (reached && asked?.askId && asked !== before.asked && asksIn(after))
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: entryIn(reached, asked.askId, asked.bundle) });
	if (event.type === "read" && before.status === "open" && before.session === after.session) {
		const [was, now] = [latestEntry(before), latestEntry(after)];
		if (now && now.turn !== asked?.askId && now.record.id !== was?.record.id) dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: now });
	}
	if (after.session !== before.session) mergeHashParams({ [CONVERSATION_PARAM]: after.session ?? "" });
});
