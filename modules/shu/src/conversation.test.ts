/**
 * The conversation machine, held to its tables, and the transcript it states.
 *
 * Every status of the conversation and every status of the page's turn is paired with every event, and asserted against
 * its table, stated a second time here. Each move that changes what the conversation holds is asserted on its own.
 * Random event sequences, seeded so a failure replays, assert that the page's turn holds what its events delivered since
 * it was asked, and that the open conversation it was asked in holds it once. The transcript is asserted over a session
 * that branches: the branch from the first turn to the turn the next question replies to, and the other branch offered
 * where it leaves.
 */
import { describe, expect, it } from "vitest";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { anIndividual, type TChatStatus, type TSessionTurn, type TTurnStatus } from "./schemas.js";
import type { TRecord } from "./current-subject.js";
import { question, answer, readBack as aReadBack } from "./components/chat-pane.test-fake.js";
import {
	CLOSED_CONVERSATION,
	CONVERSATION_EVENTS,
	CONVERSATION_OPENING,
	NOT_STARTED,
	REQUEST_EVENTS,
	SENDING,
	TURN_IN_FLIGHT,
	askRefusal,
	inFlight,
	transcript,
	transition,
	turnOf,
	type TAskedTurn,
	type TConversationEvent,
	type TConversationEventType,
	type TConversationState,
} from "./conversation.js";
import { pickWith, seededRandom } from "./test/seeded-random.js";

/** A session, named by its first turn. */
const FIRST = "0.1.1";
const SESSION = question(FIRST);
const EMAIL = anIndividual("Email", "a@test.com");
const LEVEL = "private";
/** The records the run states for the page's turn: its question, then its answer. */
const QUESTION: TRecord = { id: question("0.1.2"), label: COMMENT_LABEL };
const ANSWER: TRecord = { id: answer("0.1.2"), label: COMMENT_LABEL };

/** A turn of the session as the store reads it back, asked about the email. */
const readBack = (turn: string, inReplyTo?: string): TSessionTurn => aReadBack(turn, inReplyTo, [EMAIL]);

/** One event of each type: the session's for the session the conversation opens, and the page's turn a reply in it. */
const EVENT: Record<TConversationEventType, TConversationEvent> = {
	open: { type: "open", session: SESSION },
	read: { type: "read", session: SESSION, turns: [readBack(FIRST)] },
	failed: { type: "failed", session: SESSION },
	close: { type: "close" },
	ask: { type: "ask", prompt: "what does this say", patterns: [EMAIL], session: SESSION, inReplyTo: SESSION },
	started: { type: "started" },
	text: { type: "text", piece: "an answer" },
	status: { type: "status", line: "context sent" },
	recorded: { type: "recorded", record: QUESTION },
	stop: { type: "stop", reason: "you stopped it" },
	ended: { type: "ended" },
	erred: { type: "erred", message: "connection reset" },
};

const after = (conversation: TConversationState, ...events: TConversationEvent[]): TConversationState => events.reduce(transition, conversation);
const run = (...events: TConversationEvent[]): TConversationState => after(CLOSED_CONVERSATION, ...events);
const on = (...types: TConversationEventType[]): TConversationState => run(...types.map((type) => EVENT[type]));
/** The same status for every event but the ones named. */
const staying = <S extends string>(status: S, moves: Partial<Record<TConversationEventType, S>>): Record<TConversationEventType, S> =>
	Object.fromEntries(CONVERSATION_EVENTS.map((type) => [type, moves[type] ?? status])) as Record<TConversationEventType, S>;
const askedStatus = (conversation: TConversationState): TTurnStatus => conversation.asked?.status ?? "idle";
/** A conversation holding a turn at a status the run recorded, which no event of the page's moves a turn to. */
const holdingTurnAt = (status: TChatStatus): TConversationState => {
	const running = on("open", "read", "ask", "started");
	return { ...running, asked: { ...(running.asked as NonNullable<TConversationState["asked"]>), status } };
};

/** A conversation at each status, with no turn of the page's. */
const AT: Record<TConversationState["status"], TConversationState> = { closed: CLOSED_CONVERSATION, opening: on("open"), open: on("open", "read") };

/** The table of the conversation: the status each event moves each status to, with no turn of the page's in flight. */
const TABLE: Record<TConversationState["status"], Record<TConversationEventType, TConversationState["status"]>> = {
	closed: staying("closed", { open: "opening", ask: "open" }),
	opening: staying("opening", { read: "open", failed: "closed", close: "closed" }),
	open: staying("open", { open: "opening", close: "closed" }),
};

/** The page's turn at each status, asked in the open conversation. */
const TURN_AT: Record<TTurnStatus, TConversationState> = {
	idle: on("open", "read"),
	asking: on("open", "read", "ask"),
	running: on("open", "read", "ask", "started"),
	completed: on("open", "read", "ask", "started", "ended"),
	failed: on("open", "read", "ask", "started", "erred"),
	stopped: on("open", "read", "ask", "started", "stop", "erred"),
	// A turn ends unverified where it stated a handle what it was sent doesn't hold. The run decides that when it records
	// the turn, so no event of the page's reaches it: the page holds a turn read back at that status.
	unverified: holdingTurnAt("unverified"),
};

/** The table of the page's turn: the status each event moves each status to, for a turn no reader stopped. A turn in
 *  flight refuses a question, and so does a conversation opening, which `open` leaves the turn in. */
const TURN_TABLE: Record<TTurnStatus, Record<TConversationEventType, TTurnStatus>> = {
	idle: staying("idle", { ask: "asking" }),
	asking: staying("asking", { started: "running", ended: "failed", erred: "failed" }),
	running: staying("running", { ended: "completed", erred: "failed" }),
	completed: staying("completed", { ask: "asking" }),
	failed: staying("failed", { ask: "asking" }),
	stopped: staying("stopped", { ask: "asking" }),
	unverified: staying("unverified", { ask: "asking" }),
};

/** The status an event moves the page's turn to: the table's, except that a stopped turn's request rejecting ends it
 *  stopped, and a conversation opening refuses a question. */
const expectedStatus = (conversation: TConversationState, type: TConversationEventType): TTurnStatus => {
	const status = askedStatus(conversation);
	if (type === "erred" && inFlight(conversation.asked?.status) && conversation.asked?.stoppedBy) return "stopped";
	if (type === "ask" && conversation.status === "opening") return status;
	return TURN_TABLE[status][type];
};

describe("every status and every event", () => {
	for (const status of Object.keys(TABLE) as TConversationState["status"][]) {
		it(`moves a conversation ${status} as the table states`, () => {
			expect(AT[status].status).toBe(status);
			for (const type of CONVERSATION_EVENTS) expect(transition(AT[status], EVENT[type]).status, `${status} + ${type}`).toBe(TABLE[status][type]);
		});
	}

	for (const status of Object.keys(TURN_TABLE) as TTurnStatus[]) {
		it(`moves the page's turn ${status} as the table states`, () => {
			expect(askedStatus(TURN_AT[status])).toBe(status);
			for (const type of CONVERSATION_EVENTS) expect(askedStatus(transition(TURN_AT[status], EVENT[type])), `${status} + ${type}`).toBe(TURN_TABLE[status][type]);
		});
	}

	it("leaves a conversation whose turn is not in flight unchanged by every event of a request", () => {
		for (const status of ["idle", "completed", "failed", "stopped"] as const) {
			for (const type of REQUEST_EVENTS) expect(transition(TURN_AT[status], EVENT[type]), `${status} + ${type}`).toBe(TURN_AT[status]);
		}
	});
});

describe("each move of the conversation", () => {
	it("open reads a session with no turns yet, whatever the conversation was on, and the page's turn runs on", () => {
		const opened = transition(TURN_AT.running, { type: "open", session: question("0.2.1") });
		expect(opened).toMatchObject({ status: "opening", session: question("0.2.1"), turns: [] });
		expect(opened.asked).toBe(TURN_AT.running.asked);
	});

	it("read applies only to the session being opened or open, so a read that returns after the reader moved on changes nothing", () => {
		const moved = transition(AT.opening, { type: "open", session: question("0.2.1") });
		expect(transition(moved, EVENT.read)).toBe(moved);
		expect(transition(AT.closed, EVENT.read)).toBe(AT.closed);
		expect(AT.open.turns).toEqual([{ ...readBack(FIRST), error: "", activity: [] }]);
	});

	it("read keeps what the page's turn stated while it ran on the copy the store reads back once the turn ended", () => {
		const ended = run(EVENT.open, EVENT.read, EVENT.ask, EVENT.started, EVENT.recorded, EVENT.status, EVENT.ended);
		const read = transition(ended, { type: "read", session: SESSION, turns: [readBack(FIRST), { ...readBack("0.1.2", FIRST), response: "the store's answer" }] });
		expect(read.turns.at(-1)).toMatchObject({ askId: question("0.1.2"), response: "the store's answer", activity: ["context sent"] });
	});

	it("failed closes only the session being opened, and close leaves the session; both keep the page's turn", () => {
		const opening = transition(TURN_AT.running, EVENT.open);
		expect(transition(opening, EVENT.failed)).toEqual({ ...CLOSED_CONVERSATION, asked: TURN_AT.running.asked });
		expect(transition(TURN_AT.running, EVENT.failed)).toBe(TURN_AT.running);
		expect(transition(TURN_AT.running, EVENT.close)).toEqual({ ...CLOSED_CONVERSATION, asked: TURN_AT.running.asked });
		expect(transition(AT.closed, EVENT.close)).toBe(AT.closed);
	});

	it("ask in a closed conversation opens one on no session, and the first record of its turn names the session", () => {
		const first = { ...EVENT.ask, session: undefined, inReplyTo: undefined } as TConversationEvent;
		const asking = run(first, EVENT.started);
		expect(asking).toMatchObject({ status: "open", session: null });
		const recorded = transition(asking, EVENT.recorded);
		expect(recorded).toMatchObject({ status: "open", session: QUESTION.id });
		expect(recorded.turns.map((turn) => turn.askId)).toEqual([QUESTION.id]);
	});

	it("ask replaces the turn the run never recorded, and is refused while a turn is in flight or the conversation opens", () => {
		const refused = run(EVENT.open, EVENT.read, EVENT.ask, EVENT.erred);
		expect(refused.turns.map((turn) => [turn.askId, turn.status])).toEqual([
			[SESSION, "completed"],
			[null, "failed"],
		]);
		expect(transition(refused, EVENT.ask).turns.map((turn) => [turn.askId, turn.status])).toEqual([
			[SESSION, "completed"],
			[null, "asking"],
		]);
		expect(askRefusal(TURN_AT.running)).toBe(TURN_IN_FLIGHT);
		expect(askRefusal(AT.opening)).toBe(CONVERSATION_OPENING);
		expect(askRefusal(TURN_AT.completed)).toBeNull();
		expect(transition(TURN_AT.running, EVENT.ask)).toBe(TURN_AT.running);
		expect(transition(AT.opening, EVENT.ask)).toBe(AT.opening);
	});
});

describe("each move of the page's turn", () => {
	it("ask starts a turn with the question, its records, its session and the turn it replies to, and nothing of the turn before", () => {
		expect(transition(TURN_AT.completed, EVENT.ask).asked).toEqual({
			askId: null,
			prompt: "what does this say",
			response: "",
			bundle: [EMAIL],
			inReplyTo: SESSION,
			// The run states when the turn was asked once it records it; a turn this page is still asking states none.
			generatedAtTime: "",
			status: "asking",
			error: "",
			activity: [],
			session: SESSION,
			stoppedBy: "",
		});
	});

	it("started runs the turn, the first record the run states is its question, which names the turn, and the second its answer", () => {
		expect(TURN_AT.running.asked).toMatchObject({ status: "running", askId: null });
		const answered = run(...[EVENT.open, EVENT.read, EVENT.ask, EVENT.started, EVENT.recorded, { type: "recorded", record: ANSWER } as TConversationEvent]);
		expect(answered.asked).toMatchObject({ askId: QUESTION.id, sayId: ANSWER.id });
	});

	it("text, status and recorded add to a running turn, in order, and to no turn that is not running", () => {
		const answered = run(EVENT.open, EVENT.read, EVENT.ask, EVENT.started, EVENT.text, EVENT.status, EVENT.recorded, EVENT.text, EVENT.status, {
			type: "recorded",
			record: ANSWER,
		});
		expect(answered.asked).toMatchObject({ response: "an answeran answer", activity: ["context sent", "context sent"], askId: QUESTION.id, sayId: ANSWER.id });
		for (const type of ["text", "status", "recorded"] as const) expect(transition(TURN_AT.asking, EVENT[type]), `asking + ${type}`).toBe(TURN_AT.asking);
	});

	it("stop keeps the turn in flight with the first reason, and the request's rejection ends it stopped with that reason first", () => {
		const stopping = transition(transition(TURN_AT.running, EVENT.stop), { type: "stop", reason: "a second reason" });
		expect(stopping.asked).toMatchObject({ status: "running", stoppedBy: "you stopped it" });
		expect(transition(stopping, EVENT.erred).asked).toMatchObject({ status: "stopped", error: "you stopped it: connection reset" });
		expect(on("open", "read", "ask", "stop", "erred").asked, "a turn stopped before its step started").toMatchObject({
			status: "stopped",
			error: "you stopped it: connection reset",
		});
	});

	it("erred ends a turn no reader stopped as failed, ended a running turn as completed, and a turn whose step never started as failed", () => {
		expect(TURN_AT.failed.asked).toMatchObject({ status: "failed", error: "connection reset" });
		expect(TURN_AT.completed.asked).toMatchObject({ status: "completed", error: "" });
		expect(on("open", "read", "ask", "ended").asked).toMatchObject({ status: "failed", error: NOT_STARTED });
	});

	it("is written into the conversation it was asked in, in place of the store's copy, running and then as it ended", () => {
		const running = on("open", "read", "ask", "started", "recorded");
		const readWhileRunning = transition(running, { type: "read", session: SESSION, turns: [readBack(FIRST), { ...readBack("0.1.2", FIRST), response: "", status: "running" }] });
		const pageTurn = (conversation: TConversationState) => conversation.turns.filter((turn) => turn.askId === QUESTION.id);
		expect(pageTurn(readWhileRunning)).toEqual([turnOf(running.asked as TAskedTurn)]);
		expect(pageTurn(transition(readWhileRunning, EVENT.text))[0]).toMatchObject({ status: "running", response: "an answer" });
		expect(pageTurn(transition(transition(readWhileRunning, EVENT.text), EVENT.ended))).toMatchObject([{ status: "completed", response: "an answer" }]);
	});

	it("is written into no other session, nor into its own while that opens, and once it is read back it stands in the store's order", () => {
		const running = on("open", "read", "ask", "started", "recorded");
		const elsewhere = after(running, { type: "open", session: question("0.2.1") }, { type: "read", session: question("0.2.1"), turns: [readBack("0.2.1")] });
		expect(transition(elsewhere, EVENT.text).turns.map((turn) => turn.askId)).toEqual([question("0.2.1")]);
		const reopening = transition(elsewhere, EVENT.open);
		expect(transition(reopening, EVENT.text).turns, "what the turn streams while its session opens").toEqual([]);
		const reopened = transition(reopening, {
			type: "read",
			session: SESSION,
			turns: [readBack(FIRST), { ...readBack("0.1.2", FIRST), status: "running" }, readBack("0.1.3", FIRST)],
		});
		expect(reopened.turns.map((turn) => [turn.askId, turn.status])).toEqual([
			[SESSION, "completed"],
			[QUESTION.id, "running"],
			[question("0.1.3"), "completed"],
		]);
	});
});

describe("any sequence of events", () => {
	it("moves the page's turn only as its table states, it holds what its events delivered since it was asked, and the conversation it was asked in holds it once", () => {
		for (let seed = 1; seed <= 200; seed++) {
			const random = seededRandom(seed);
			let conversation = CLOSED_CONVERSATION;
			// What the page's turn holds, stated again from the events since the last question the conversation took.
			const unasked = () => ({ askId: null as string | null, sayId: undefined as string | undefined, response: "", activity: [] as string[], stoppedBy: "" });
			let held = unasked();
			const path: string[] = [];
			for (let step = 0; step < 40; step++) {
				const type = pickWith(random, CONVERSATION_EVENTS);
				const event = EVENT[type];
				path.push(type);
				const label = `seed ${seed}: ${path.join(" ")}`;
				const wanted = expectedStatus(conversation, type);
				const running = conversation.asked?.status === "running";
				if (event.type === "ask" && !askRefusal(conversation)) held = unasked();
				if (event.type === "text" && running) held.response += event.piece;
				if (event.type === "status" && running) held.activity = [...held.activity, event.line];
				if (event.type === "recorded" && running) {
					if (held.askId === null) held.askId = event.record.id;
					else held.sayId = event.record.id;
				}
				if (event.type === "stop" && inFlight(conversation.asked?.status) && !held.stoppedBy) held.stoppedBy = event.reason;
				conversation = transition(conversation, event);
				expect(askedStatus(conversation), label).toBe(wanted);
				expect(conversation.turns.filter((turn) => turn.askId === null).length, `${label}: one turn at most no question names`).toBeLessThanOrEqual(1);
				const { asked } = conversation;
				if (!asked) continue;
				const { askId, sayId, response, activity, stoppedBy } = asked;
				expect({ askId, sayId, response, activity, stoppedBy }, label).toEqual(held);
				if (conversation.status !== "open" || asked.session !== conversation.session) continue;
				const holds = conversation.turns.filter((turn) => turn.askId === asked.askId);
				expect(holds, `${label}: the conversation holds the page's turn once`).toHaveLength(1);
				if (inFlight(asked.status)) expect(holds, `${label}: as the page holds it while it runs`).toEqual([turnOf(asked)]);
			}
		}
	});
});

describe("the transcript", () => {
	/** The first turn, a reply to it, a reply to that, and a second reply to the first turn, in the store's order. */
	const READ = [readBack(FIRST), readBack("0.1.3", FIRST), readBack("0.1.4", "0.1.3"), readBack("0.1.5", FIRST)];
	const BRANCHED = run(EVENT.open, { type: "read", session: SESSION, turns: READ });
	const shownTurns = (entries: ReturnType<typeof transcript>) => [...new Set(entries.filter((entry) => entry.shown).map((entry) => entry.message.turn ?? "pending"))];
	const answerIn = (entries: ReturnType<typeof transcript>, turn: string) => entries.find((entry) => entry.message.role === "llm" && entry.message.turn === turn)?.message;

	it("lists every turn's question and answer, and shows the branch of the newest turn where the next question replies to none", () => {
		const entries = transcript(BRANCHED, undefined, LEVEL);
		expect(entries).toHaveLength(8);
		expect(shownTurns(entries)).toEqual([SESSION, question("0.1.5")]);
		expect(answerIn(entries, SESSION)?.otherBranch, "the other branch, offered by its latest answer").toEqual({
			recordId: answer("0.1.4"),
			turn: question("0.1.4"),
			bundle: { patterns: [EMAIL], accessLevel: LEVEL },
			count: 1,
		});
	});

	it("states when each turn was asked, which is what a reader's place on the timeline reads", () => {
		const entries = transcript(BRANCHED, undefined, LEVEL);
		const askedAt = (turn: string) => entries.find((entry) => entry.message.turn === turn)?.askedAt;
		expect(askedAt(SESSION), "the instant the run recorded the question at").toBe(Date.parse(readBack(FIRST).generatedAtTime));
		expect(askedAt(question("0.1.5")) ?? 0, "and a later turn was asked later").toBeGreaterThan(askedAt(SESSION) ?? 0);
	});

	it("shows the branch through the turn the next question replies to, and its newest replies below it", () => {
		const older = transcript(BRANCHED, question("0.1.3"), LEVEL);
		expect(shownTurns(older)).toEqual([SESSION, question("0.1.3"), question("0.1.4")]);
		expect(answerIn(older, SESSION)?.otherBranch?.turn, "and offers the newer branch").toBe(question("0.1.5"));
		expect(shownTurns(transcript(BRANCHED, SESSION, LEVEL)), "an earlier turn shows its newest continuation").toEqual([SESSION, question("0.1.5")]);
	});

	it("shows the page's turn before the run records its question on the branch it replies to, sending, with both earlier branches offered", () => {
		const entries = transcript(transition(BRANCHED, EVENT.ask), SESSION, LEVEL);
		expect(shownTurns(entries)).toEqual([SESSION, "pending"]);
		expect(entries.at(-1)?.message).toMatchObject({ role: "llm", status: "asking", spinnerStatus: SENDING, spinnerVisible: true });
		expect(answerIn(entries, SESSION)?.otherBranch?.count).toBe(2);
	});

	it("offers a branch whose latest turn was stopped before its answer was recorded, by that turn's question", () => {
		const stopped = after(BRANCHED, EVENT.ask, EVENT.started, { type: "recorded", record: { id: question("0.1.6"), label: COMMENT_LABEL } }, EVENT.stop, EVENT.erred);
		expect(answerIn(transcript(stopped, question("0.1.4"), LEVEL), SESSION)?.otherBranch).toMatchObject({ recordId: question("0.1.6"), turn: question("0.1.6"), count: 2 });
	});

	it("gives each message its comment, its turn's records and the turn it replies to, and each answer how its turn ended", () => {
		const failed = transition(BRANCHED, {
			type: "read",
			session: SESSION,
			turns: [...READ, { ...readBack("0.1.6", "0.1.5"), response: "", status: "failed", error: "connection reset" }],
		});
		const [asked, answered] = transcript(failed, undefined, LEVEL)
			.slice(-2)
			.map((entry) => entry.message);
		expect(asked).toMatchObject({
			role: "user",
			text: "asked 0.1.6",
			recordId: question("0.1.6"),
			inReplyTo: question("0.1.5"),
			bundle: { patterns: [EMAIL], accessLevel: LEVEL },
		});
		expect(answered).toMatchObject({ role: "llm", status: "failed", error: "connection reset", recordId: answer("0.1.6"), spinnerVisible: false });
	});

	it("shows every turn of a conversation that never branched and offers nothing, and nothing for a conversation with no turns", () => {
		const straight = run(EVENT.open, { type: "read", session: SESSION, turns: [readBack(FIRST), readBack("0.1.2", FIRST)] });
		const entries = transcript(straight, question("0.1.2"), LEVEL);
		expect(entries.every((entry) => entry.shown && !entry.message.otherBranch)).toBe(true);
		expect(transcript(CLOSED_CONVERSATION, undefined, LEVEL)).toEqual([]);
	});
});
