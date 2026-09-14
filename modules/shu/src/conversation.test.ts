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
import { question, answer, readBack as aReadBack } from "./components/chat-pane.test-fake.js";
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

/** A session, named by its first turn. */
const FIRST = "0.1.1";
const SESSION = question(FIRST);
const EMAIL = anIndividual("Email", "a@test.com");
const LEVEL = "private";

/** A turn of the session as the store reads it back, asked about the email. */
const readBack = (turn: string, inReplyTo?: string): TSessionTurn => aReadBack(turn, inReplyTo, [EMAIL]);

/** One event of each type, for the session the conversation opens. */
const EVENT: Record<TConversationEventType, TConversationEvent> = {
	open: { type: "open", session: SESSION },
	opened: { type: "opened", session: SESSION, turns: [readBack(FIRST)] },
	failed: { type: "failed", session: SESSION },
	close: { type: "close" },
	turnAsked: { type: "turnAsked", turn: question("0.1.9") },
	turnEnded: { type: "turnEnded", session: SESSION, turn: readBack("0.1.2", FIRST) },
};

const run = (...events: TConversationEvent[]): TConversationState => events.reduce(transition, CLOSED_CONVERSATION);
const AT: Record<TConversationState["status"], TConversationState> = { closed: CLOSED_CONVERSATION, opening: run(EVENT.open), open: run(EVENT.open, EVENT.opened) };

/** The table: the status each event moves each status to. */
const TABLE: Record<TConversationState["status"], Record<TConversationEventType, TConversationState["status"]>> = {
	closed: { open: "opening", opened: "closed", failed: "closed", close: "closed", turnAsked: "open", turnEnded: "closed" },
	opening: { open: "opening", opened: "open", failed: "closed", close: "closed", turnAsked: "opening", turnEnded: "opening" },
	open: { open: "opening", opened: "open", failed: "open", close: "closed", turnAsked: "open", turnEnded: "open" },
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
		expect(transition(AT.open, { type: "open", session: question("0.2.1") })).toEqual({ status: "opening", session: question("0.2.1"), turns: [] });
	});

	it("opened and failed apply only to the session being opened, so a read that returns after the reader moved on changes nothing", () => {
		const moved = transition(AT.opening, { type: "open", session: question("0.2.1") });
		expect(transition(moved, EVENT.opened)).toBe(moved);
		expect(transition(moved, EVENT.failed)).toBe(moved);
		expect(AT.open.turns).toEqual([readBack(FIRST)]);
	});

	it("turnAsked opens a closed conversation on the first turn's question, and leaves one that has a session", () => {
		expect(transition(AT.closed, EVENT.turnAsked)).toEqual({ status: "open", session: question("0.1.9"), turns: [] });
		expect(transition(AT.open, EVENT.turnAsked)).toBe(AT.open);
	});

	it("turnEnded appends a turn of the open session once, and leaves a turn of another session out", () => {
		const ended = transition(transition(AT.open, EVENT.turnEnded), {
			...EVENT.turnEnded,
			turn: { ...readBack("0.1.2", FIRST), response: "answered again" },
		} as TConversationEvent);
		expect(ended.turns.map((turn) => [turn.askId, turn.response])).toEqual([
			[SESSION, "answered 0.1.1"],
			[question("0.1.2"), "answered again"],
		]);
		expect(transition(AT.open, { ...EVENT.turnEnded, session: question("0.2.1") } as TConversationEvent)).toBe(AT.open);
	});

	it("close leaves the session, and a closed conversation is unchanged by it", () => {
		expect(transition(AT.open, EVENT.close)).toBe(CLOSED_CONVERSATION);
		expect(transition(AT.closed, EVENT.close)).toBe(AT.closed);
	});
});

describe("the page's turn and the conversation", () => {
	it("is one of the conversation's when it was asked in the session, and not when it was asked in another", () => {
		expect(turnOfConversation(AT.open, turnAfter(SESSION, SESSION))).toBe(true);
		expect(turnOfConversation(AT.open, turnAfter(question("0.2.1"), question("0.2.1")))).toBe(false);
		expect(turnOfConversation(AT.closed, turnAfter(SESSION, SESSION)), "a conversation the reader left").toBe(false);
		expect(turnOfConversation(AT.open, IDLE_TURN)).toBe(false);
	});

	it("is a closed conversation's first turn until the run records its question, and the conversation's it opened after", () => {
		const asking = turnAfter(undefined, undefined);
		expect(turnOfConversation(AT.closed, asking)).toBe(true);
		expect(turnOfConversation(AT.opening, asking), "a session the reader opened before the question was recorded").toBe(false);
		const asked = turnTransition(turnTransition(asking, { type: "started" }), { type: "recorded", record: { id: question("0.1.9"), label: "Comment" } });
		expect(turnOfConversation(transition(AT.closed, EVENT.turnAsked), asked)).toBe(true);
		expect(turnOfConversation(AT.open, asked)).toBe(false);
	});

	it("refuses a question while a turn is in flight, and while the conversation opens", () => {
		const running = turnAfter(SESSION, SESSION, { type: "started" });
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
		turns: [readBack(FIRST), readBack("0.1.3", FIRST), readBack("0.1.4", "0.1.3"), readBack("0.1.5", FIRST)],
	});
	const shownTurns = (entries: ReturnType<typeof transcript>) => [...new Set(entries.filter((entry) => entry.shown).map((entry) => entry.message.turn ?? "pending"))];
	const answerIn = (entries: ReturnType<typeof transcript>, turn: string) => entries.find((entry) => entry.message.role === "llm" && entry.message.turn === turn)?.message;

	it("lists every turn's question and answer, and shows the branch of the newest turn where the next question replies to none", () => {
		const entries = transcript(BRANCHED, IDLE_TURN, undefined, LEVEL);
		expect(entries).toHaveLength(8);
		expect(shownTurns(entries)).toEqual([SESSION, question("0.1.5")]);
		expect(answerIn(entries, SESSION)?.otherBranch, "the other branch, offered by its latest answer").toEqual({
			recordId: answer("0.1.4"),
			turn: question("0.1.4"),
			bundle: { patterns: [EMAIL], accessLevel: LEVEL },
			count: 1,
		});
	});

	it("shows the branch through the turn the next question replies to, and its newest replies below it", () => {
		const older = transcript(BRANCHED, IDLE_TURN, question("0.1.3"), LEVEL);
		expect(shownTurns(older)).toEqual([SESSION, question("0.1.3"), question("0.1.4")]);
		expect(answerIn(older, SESSION)?.otherBranch?.turn, "and offers the newer branch").toBe(question("0.1.5"));
		expect(shownTurns(transcript(BRANCHED, IDLE_TURN, SESSION, LEVEL)), "an earlier turn shows its newest continuation").toEqual([SESSION, question("0.1.5")]);
	});

	it("shows the page's turn before the run records its question on the branch it replies to, sending, with both earlier branches offered", () => {
		const entries = transcript(BRANCHED, turnAfter(SESSION, SESSION), SESSION, LEVEL);
		expect(shownTurns(entries)).toEqual([SESSION, "pending"]);
		expect(entries.at(-1)?.message).toMatchObject({ role: "llm", status: "asking", spinnerStatus: SENDING, spinnerVisible: true });
		expect(answerIn(entries, SESSION)?.otherBranch?.count).toBe(2);
	});

	it("lists the page's turn once after it is appended, and not at all where it is not one of the conversation's", () => {
		const running = turnAfter(SESSION, question("0.1.5"), { type: "started" }, { type: "recorded", record: { id: question("0.1.6"), label: "Comment" } }, { type: "text", piece: "an answer" });
		const ended = turnTransition(running, { type: "ended" });
		const appended = transition(BRANCHED, { type: "turnEnded", session: SESSION, turn: { ...readBack("0.1.6", "0.1.5"), response: "an answer", status: "completed" } });
		expect(transcript(appended, ended, undefined, LEVEL).filter((entry) => entry.message.turn === question("0.1.6"))).toHaveLength(2);
		expect(transcript(BRANCHED, turnAfter(question("0.2.1"), question("0.2.1")), undefined, LEVEL)).toHaveLength(8);
	});

	it("shows the page's turn in place of the copy a session read back while the turn ran, running, and then as it ended", () => {
		const running = turnAfter(SESSION, question("0.1.5"), { type: "started" }, { type: "recorded", record: { id: question("0.1.6"), label: "Comment" } });
		const readWhileRunning = run(EVENT.open, { type: "opened", session: SESSION, turns: [...BRANCHED.turns, { ...readBack("0.1.6", "0.1.5"), response: "", status: "running" }] });
		const shownFor = (turn: TTurnState) => transcript(readWhileRunning, turn, undefined, LEVEL).filter((entry) => entry.message.turn === question("0.1.6"));
		expect(shownFor(running).map((entry) => entry.message.role)).toEqual(["user", "llm"]);
		expect(shownFor(turnTransition(running, { type: "text", piece: "streamed" })).at(-1)?.message).toMatchObject({ status: "running", text: "streamed", spinnerVisible: true });
		const ended = turnTransition(turnTransition(running, { type: "text", piece: "the answer" }), { type: "ended" });
		expect(shownFor(ended).at(-1)?.message).toMatchObject({ status: "completed", text: "the answer" });
	});

	it("gives each message its comment, its turn's bundle and the turn it replies to, and each answer how its turn ended", () => {
		const failed = transition(BRANCHED, {
			type: "turnEnded",
			session: SESSION,
			turn: { ...readBack("0.1.6", "0.1.5"), response: "", status: "failed", error: "connection reset" },
		});
		const [asked, answered] = transcript(failed, IDLE_TURN, undefined, LEVEL)
			.slice(-2)
			.map((entry) => entry.message);
		expect(asked).toMatchObject({ role: "user", text: "asked 0.1.6", recordId: question("0.1.6"), inReplyTo: question("0.1.5"), bundle: { patterns: [EMAIL], accessLevel: LEVEL } });
		expect(answered).toMatchObject({ role: "llm", status: "failed", error: "connection reset", recordId: answer("0.1.6"), spinnerVisible: false });
	});

	it("shows every turn of a conversation that never branched and offers nothing, and nothing for a conversation with no turns", () => {
		const straight = run(EVENT.open, { type: "opened", session: SESSION, turns: [readBack(FIRST), readBack("0.1.2", FIRST)] });
		const entries = transcript(straight, IDLE_TURN, question("0.1.2"), LEVEL);
		expect(entries.every((entry) => entry.shown && !entry.message.otherBranch)).toBe(true);
		expect(transcript(CLOSED_CONVERSATION, IDLE_TURN, undefined, LEVEL)).toEqual([]);
	});
});
