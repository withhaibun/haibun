/**
 * A conversation's sessions. Opening a session reads its turns back, and closing it leaves the next question to start a
 * session. Following actuality's reports reads the open session again when a turn's step starts or ends, which is how a
 * page holds a turn that a reader sends on another page. Following the conversation activates each record of the page's
 * turn in the actions bar's scope, and writes the session to the view hash.
 */
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { CONVERSATION_DOMAIN, SESSION_PARAM, SessionReadSchema, type TContextPattern, type TSessionTurn } from "@haibun/core/lib/conversation/domains/conversation.js";
import type { TEvent } from "../../ports.js";
import { reads } from "../../domains/links.js";
import { SCOPE, recordOf, type TEntry, type TRecord } from "../../../current-subject.js";
import type { TConversationState } from "../domains/conversation.js";
import { asksIn } from "../machines/conversation.js";
import type { TConversationScope } from "../ports.js";

/** How many turns a session gained since this page last read it, by the turns the page read of each session. */
export function gainedSince(read: Readonly<Record<string, number>>, session: string, turns: number): number {
	const held = read[session];
	return Math.max(0, held === undefined ? turns : turns - held);
}

/** Records that this page has read a session's turns. */
function readTurnsOf(scope: TConversationScope, session: string, turns: number): void {
	const read = scope.sessionsRead.get();
	if (read[session] === turns) return;
	scope.sessionsRead.set({ ...read, [session]: turns });
}

/** Reads a session's turns back through the step that returns a session. */
async function readSession(scope: TConversationScope, session: string): Promise<TSessionTurn[]> {
	await scope.readSteps();
	const read = scope.steps()?.session;
	if (read === undefined) throw new Error(`actuality doesn't declare a step that returns ${CONVERSATION_DOMAIN.SESSION}, which reads a conversation's session back`);
	return SessionReadSchema.parse(await scope.conduit().follow(reads(read.method, { [SESSION_PARAM]: session }), "conversation: read a session back")).turns;
}

/**
 * Opens the conversation on a session and reads its turns back. The actions bar's scope doesn't hold a turn while the
 * session is read. The event type that `answer` names is then raised on the scope with an entry for the latest turn.
 * The entry holds that turn's response record, else its question record. `answer` is `update` for a page that opens the
 * conversation its address names. It is `activate` for a reader who selected the session. Only the read that opened
 * the conversation raises the event. A read that returns after the reader closed the conversation or opened another
 * session doesn't change the scope, nor does a read that returns after another read opened the conversation: the
 * reader's later selection stays. A read that fails closes the conversation and is reported to actuality.
 */
export async function openConversation(scope: TConversationScope, session: string, answer: "activate" | "update"): Promise<void> {
	scope.conversation.dispatch({ type: "open", session });
	scope.subject({ type: "clear", scope: SCOPE.actionsBar });
	try {
		const turns = await readSession(scope, session);
		readTurnsOf(scope, session, turns.length);
		const before = scope.conversation.state.get();
		const latest = latestEntry(scope, scope.conversation.dispatch({ type: "read", session, turns }));
		if (before.status !== "opening" || before.session !== session || !latest) return;
		scope.subject({ type: answer, scope: SCOPE.actionsBar, entry: latest });
	} catch (err) {
		scope.conversation.dispatch({ type: "failed", session });
		scope.report(`the conversation ${session} was not read back: ${errorDetail(err)}`);
	}
}

/** Closes the conversation, so the next question starts a session. Clears the actions bar's scope. */
export function closeConversation(scope: TConversationScope): void {
	scope.conversation.dispatch({ type: "close" });
	scope.subject({ type: "clear", scope: SCOPE.actionsBar });
}

/** Calls `onReport` when actuality's stream reports a turn's step starting or ending, and when the stream reconnects.
 *  Any page can send the turn, and a page that didn't send it reads a session's new turns this way. A report names the
 *  step that sends a turn, which the page reads from actuality's steps, so a report that arrives before that read can't be
 *  recognized, and `onReport` is called once the read returns (TX21). A page without an event stream doesn't receive
 *  reports. Returns a function that stops following. */
export function followReportedTurns(scope: TConversationScope, onReport: () => void): () => void {
	if (!scope.streams()) return () => undefined;
	scope.readSteps().then(onReport, (err: unknown) => scope.report(`actuality's steps were not read, so its turns are not followed: ${errorDetail(err)}`));
	const reportsATurn = (event: TEvent): boolean => event.kind === "lifecycle" && event.type === "step" && event.actionName === scope.steps()?.ask.stepName;
	return scope.batched({ filter: reportsATurn, onBatch: onReport, onReconnect: onReport });
}

/** Reads the open conversation's session again on each report of a turn, one read at a time: a report that arrives during
 *  a read causes one more read after that read returns. A report that arrives while the conversation opens causes a read once
 *  it opens, since the open's read may have read the session before the turn the report names reached its record (TX21).
 *  Returns a function that stops following. */
export function followRunningTurns(scope: TConversationScope): () => void {
	let reading = false;
	let reportedMeanwhile = false;
	const readAgain = (): void => {
		const { status, session } = scope.conversation.state.get();
		if (status === "opening") {
			reportedMeanwhile = true;
			return;
		}
		if (status !== "open" || session === null) return;
		if (reading) {
			reportedMeanwhile = true;
			return;
		}
		reading = true;
		readSession(scope, session)
			.then(
				(read) => {
					const now = scope.conversation.state.get();
					if (now.status !== "open" || now.session !== session) return;
					readTurnsOf(scope, session, read.length);
					scope.conversation.dispatch({ type: "read", session, turns: read });
				},
				(err: unknown) => scope.report(`the conversation ${session} was not read again: ${errorDetail(err)}`),
			)
			.finally(() => {
				reading = false;
				readReported();
			});
	};
	/** Reads again where a report arrived during the last read or while the conversation opened. */
	const readReported = (): void => {
		if (!reportedMeanwhile) return;
		reportedMeanwhile = false;
		readAgain();
	};
	const stopOpening = scope.conversation.follow(({ before, after }) => {
		if (before.status === "opening" && after.status === "open") readReported();
	});
	const stopReports = followReportedTurns(scope, readAgain);
	return () => {
		stopOpening();
		stopReports();
	};
}

/** The actions bar's entry for a record of the turn `askId` names. Its bundle holds the patterns the turn's question references. */
const entryIn = (scope: TConversationScope, record: TRecord, askId: string, patterns: TContextPattern[]): TEntry => ({
	record,
	turn: askId,
	bundle: { patterns, accessLevel: scope.readLevel() },
});

/** The entry for the newest record of a conversation's latest turn: its response where it has one, else its question. */
function latestEntry(scope: TConversationScope, conversation: TConversationState): TEntry | null {
	const latest = conversation.turns.at(-1);
	if (!latest?.askId) return null;
	return entryIn(scope, { id: latest.sayId === undefined ? latest.askId : latest.sayId, label: COMMENT_LABEL }, latest.askId, latest.bundle);
}

/** Follows each move so the actions bar's scope holds the conversation's newest record. It activates each comment and
 *  each call the page's turn records in the open conversation, and the newest comment of another page's turn once a read
 *  returns it. It writes the session to the view hash. A turn's records don't activate a conversation that is still
 *  opening, since the read that opens it activates its latest turn. Returns a function that stops following. */
export function followConversation(scope: TConversationScope): () => void {
	return scope.conversation.follow(({ event, before, after }) => {
		const { asked } = after;
		const reached = event.type === "recorded" ? event.record : event.type === "called" ? event.calls.map((call) => recordOf(call.record)).at(-1) : undefined;
		if (reached && asked?.askId && asked !== before.asked && asksIn(after))
			scope.subject({ type: "activate", scope: SCOPE.actionsBar, entry: entryIn(scope, reached, asked.askId, asked.bundle) });
		if (event.type === "read" && before.status === "open" && before.session === after.session) {
			const [was, now] = [latestEntry(scope, before), latestEntry(scope, after)];
			if (now && now.turn !== asked?.askId && now.record?.id !== was?.record?.id) scope.subject({ type: "activate", scope: SCOPE.actionsBar, entry: now });
		}
		if (after.session !== before.session) scope.address(after.session);
	});
}
