/**
 * The conversation machine, held to its table, and the transcript it states.
 *
 * Every status is paired with every event and asserted against the table, stated a second time here. Each move that
 * changes what the conversation holds is asserted on its own, then which turn of the page is one of the conversation's
 * and when a question is refused. The transcript is asserted over a session that branches: the branch from the first
 * turn to the turn the next question replies to, the other branch offered where it leaves, and the page's turn where it
 * is one of the conversation's.
 */
import { describe, expect, it } from "vitest";
import { anIndividual, type TSessionTurn } from "./schemas.js";
import { readBack as aReadBack } from "./components/chat-pane.test-fake.js";
import { IDLE_TURN, transition as turnTransition, turnRefusal, type TTurnEvent, type TTurnState } from "./chat-turn.js";
import {
	CLOSED_CONVERSATION,
	CONVERSATION_EVENTS,
	CONVERSATION_OPENING,
	SENDING,
	askRefusal,
	transcript,
	transition,
	turnOfConversation,
	type TConversationEvent,
	type TConversationEventType,
	type TConversationState,
} from "./conversation.js";

const SESSION = "0.1.1";
const EMAIL = anIndividual("Email", "a@test.com");
const LEVEL = "private";

/** A turn of the session as the store reads it back, asked about the email. */
const readBack = (seqPath: string, inReplyTo?: string): TSessionTurn => aReadBack(seqPath, inReplyTo, [EMAIL]);

/** One event of each type, for the session the conversation opens. */
const EVENT: Record<TConversationEventType, TConversationEvent> = {
	open: { type: "open", session: SESSION },
	opened: { type: "opened", session: SESSION, turns: [readBack(SESSION)] },
	failed: { type: "failed", session: SESSION },
	close: { type: "close" },
	turnStarted: { type: "turnStarted", seqPath: "0.1.9" },
	turnEnded: { type: "turnEnded", session: SESSION, turn: readBack("0.1.2", SESSION) },
};

const run = (...events: TConversationEvent[]): TConversationState => events.reduce(transition, CLOSED_CONVERSATION);
const AT: Record<TConversationState["status"], TConversationState> = { closed: CLOSED_CONVERSATION, opening: run(EVENT.open), open: run(EVENT.open, EVENT.opened) };

/** The table: the status each event moves each status to. */
const TABLE: Record<TConversationState["status"], Record<TConversationEventType, TConversationState["status"]>> = {
	closed: { open: "opening", opened: "closed", failed: "closed", close: "closed", turnStarted: "open", turnEnded: "closed" },
	opening: { open: "opening", opened: "open", failed: "closed", close: "closed", turnStarted: "opening", turnEnded: "opening" },
	open: { open: "opening", opened: "open", failed: "open", close: "closed", turnStarted: "open", turnEnded: "open" },
};

/** The page's turn after the events, from a question asked with the session and the turn it replies to. */
const turnAfter = (session: string | undefined, inReplyTo: string | undefined, ...events: TTurnEvent[]): TTurnState =>
	[{ type: "ask", prompt: "and what else", bundle: { patterns: [EMAIL], accessLevel: LEVEL }, session, inReplyTo } as TTurnEvent, ...events].reduce(turnTransition, IDLE_TURN);

describe("every status and every event", () => {
	for (const status of Object.keys(TABLE) as TConversationState["status"][]) {
		it(`moves a conversation ${status} as the table states`, () => {
			expect(AT[status].status).toBe(status);
			for (const type of CONVERSATION_EVENTS) expect(transition(AT[status], EVENT[type]).status, `${status} + ${type}`).toBe(TABLE[status][type]);
		});
	}
});

describe("each move", () => {
	it("open reads a session with no turns yet, whatever the conversation was on", () => {
		expect(transition(AT.open, { type: "open", session: "0.2.1" })).toEqual({ status: "opening", session: "0.2.1", turns: [] });
	});

	it("opened and failed apply only to the session being opened, so a read that returns after the reader moved on changes nothing", () => {
		const moved = transition(AT.opening, { type: "open", session: "0.2.1" });
		expect(transition(moved, EVENT.opened)).toBe(moved);
		expect(transition(moved, EVENT.failed)).toBe(moved);
		expect(AT.open.turns).toEqual([readBack(SESSION)]);
	});

	it("turnStarted opens a closed conversation on the first turn's seqPath, and leaves one that has a session", () => {
		expect(transition(AT.closed, EVENT.turnStarted)).toEqual({ status: "open", session: "0.1.9", turns: [] });
		expect(transition(AT.open, EVENT.turnStarted)).toBe(AT.open);
	});

	it("turnEnded appends a turn of the open session once, and leaves a turn of another session out", () => {
		const ended = transition(transition(AT.open, EVENT.turnEnded), {
			...EVENT.turnEnded,
			turn: { ...readBack("0.1.2", SESSION), response: "answered again" },
		} as TConversationEvent);
		expect(ended.turns.map((turn) => [turn.seqPath, turn.response])).toEqual([
			[SESSION, "answered 0.1.1"],
			["0.1.2", "answered again"],
		]);
		expect(transition(AT.open, { ...EVENT.turnEnded, session: "0.2.1" } as TConversationEvent)).toBe(AT.open);
	});

	it("close leaves the session, and a closed conversation is unchanged by it", () => {
		expect(transition(AT.open, EVENT.close)).toBe(CLOSED_CONVERSATION);
		expect(transition(AT.closed, EVENT.close)).toBe(AT.closed);
	});
});

describe("the page's turn and the conversation", () => {
	it("is one of the conversation's when it was asked in the session, and not when it was asked in another", () => {
		expect(turnOfConversation(AT.open, turnAfter(SESSION, SESSION))).toBe(true);
		expect(turnOfConversation(AT.open, turnAfter("0.2.1", "0.2.1"))).toBe(false);
		expect(turnOfConversation(AT.closed, turnAfter(SESSION, SESSION)), "a conversation the reader left").toBe(false);
		expect(turnOfConversation(AT.open, IDLE_TURN)).toBe(false);
	});

	it("is a closed conversation's first turn until its step starts, and the conversation's it opened after", () => {
		const asking = turnAfter(undefined, undefined);
		expect(turnOfConversation(AT.closed, asking)).toBe(true);
		expect(turnOfConversation(AT.opening, asking), "a session the reader opened before the step started").toBe(false);
		const started = turnTransition(asking, { type: "started", seqPath: "0.1.9" });
		expect(turnOfConversation(transition(AT.closed, EVENT.turnStarted), started)).toBe(true);
		expect(turnOfConversation(AT.open, started)).toBe(false);
	});

	it("refuses a question while a turn is in flight, and while the conversation opens", () => {
		const running = turnAfter(SESSION, SESSION, { type: "started", seqPath: "0.1.2" });
		expect(askRefusal(AT.open, running)).toBe(turnRefusal(running));
		expect(askRefusal(AT.opening, IDLE_TURN)).toBe(CONVERSATION_OPENING);
		expect(askRefusal(AT.open, IDLE_TURN)).toBeNull();
		expect(askRefusal(AT.closed, turnTransition(running, { type: "ended" }))).toBeNull();
	});
});

describe("the transcript", () => {
	/** The first turn, a reply to it, a reply to that, and a second reply to the first turn, in the store's order. */
	const BRANCHED = run(EVENT.open, {
		type: "opened",
		session: SESSION,
		turns: [readBack(SESSION), readBack("0.1.3", SESSION), readBack("0.1.4", "0.1.3"), readBack("0.1.5", SESSION)],
	});
	const shownTurns = (entries: ReturnType<typeof transcript>) => [...new Set(entries.filter((entry) => entry.shown).map((entry) => entry.message.seqPath ?? "pending"))];
	const answerOf = (entries: ReturnType<typeof transcript>, seqPath: string) => entries.find((entry) => entry.message.role === "llm" && entry.message.seqPath === seqPath)?.message;

	it("lists every turn's question and answer, and shows the branch of the newest turn where the next question replies to none", () => {
		const entries = transcript(BRANCHED, IDLE_TURN, undefined, LEVEL);
		expect(entries).toHaveLength(8);
		expect(shownTurns(entries)).toEqual([SESSION, "0.1.5"]);
		expect(answerOf(entries, SESSION)?.otherBranch, "the other branch, offered by its latest answer").toEqual({
			recordId: "cmt-say-0.1.4",
			seqPath: "0.1.4",
			bundle: { patterns: [EMAIL], accessLevel: LEVEL },
			count: 1,
		});
	});

	it("shows the branch through the turn the next question replies to, and its newest replies below it", () => {
		const older = transcript(BRANCHED, IDLE_TURN, "0.1.3", LEVEL);
		expect(shownTurns(older)).toEqual([SESSION, "0.1.3", "0.1.4"]);
		expect(answerOf(older, SESSION)?.otherBranch?.seqPath, "and offers the newer branch").toBe("0.1.5");
		expect(shownTurns(transcript(BRANCHED, IDLE_TURN, SESSION, LEVEL)), "an earlier turn shows its newest continuation").toEqual([SESSION, "0.1.5"]);
	});

	it("shows the page's turn before its step starts on the branch it replies to, sending, with both earlier branches offered", () => {
		const entries = transcript(BRANCHED, turnAfter(SESSION, SESSION), SESSION, LEVEL);
		expect(shownTurns(entries)).toEqual([SESSION, "pending"]);
		expect(entries.at(-1)?.message).toMatchObject({ role: "llm", status: "asking", spinnerStatus: SENDING, spinnerVisible: true });
		expect(answerOf(entries, SESSION)?.otherBranch?.count).toBe(2);
	});

	it("lists the page's turn once after it is appended, and not at all where it is not one of the conversation's", () => {
		const running = turnAfter(SESSION, "0.1.5", { type: "started", seqPath: "0.1.6" }, { type: "text", piece: "an answer" });
		const ended = turnTransition(running, { type: "ended" });
		const appended = transition(BRANCHED, { type: "turnEnded", session: SESSION, turn: { ...readBack("0.1.6", "0.1.5"), response: "an answer", status: "completed" } });
		expect(transcript(appended, ended, undefined, LEVEL).filter((entry) => entry.message.seqPath === "0.1.6")).toHaveLength(2);
		expect(transcript(BRANCHED, turnAfter("0.2.1", "0.2.1"), undefined, LEVEL)).toHaveLength(8);
	});

	it("gives each message its comment, its turn's bundle and the turn it replies to, and each answer how its turn ended", () => {
		const failed = transition(BRANCHED, {
			type: "turnEnded",
			session: SESSION,
			turn: { ...readBack("0.1.6", "0.1.5"), response: "", status: "failed", error: "connection reset" },
		});
		const [question, answer] = transcript(failed, IDLE_TURN, undefined, LEVEL)
			.slice(-2)
			.map((entry) => entry.message);
		expect(question).toMatchObject({ role: "user", text: "asked 0.1.6", recordId: "cmt-ask-0.1.6", inReplyTo: "0.1.5", bundle: { patterns: [EMAIL], accessLevel: LEVEL } });
		expect(answer).toMatchObject({ role: "llm", status: "failed", error: "connection reset", recordId: "cmt-say-0.1.6", spinnerVisible: false });
	});

	it("shows every turn of a conversation that never branched and offers nothing, and nothing for a conversation with no turns", () => {
		const straight = run(EVENT.open, { type: "opened", session: SESSION, turns: [readBack(SESSION), readBack("0.1.2", SESSION)] });
		const entries = transcript(straight, IDLE_TURN, "0.1.2", LEVEL);
		expect(entries.every((entry) => entry.shown && !entry.message.otherBranch)).toBe(true);
		expect(transcript(CLOSED_CONVERSATION, IDLE_TURN, undefined, LEVEL)).toEqual([]);
	});
});
