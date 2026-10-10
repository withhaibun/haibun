/**
 * Tests the conversation machine against its tables and tests the messages that `transcript` returns.
 *
 * Each status of the conversation and each status of the page's turn is paired with every event. Each pair is asserted
 * against a table that restates the machine's moves here. Each move that changes what the conversation holds has its own
 * case. A test runs seeded random event sequences, so a failing sequence replays. It asserts that the page's turn holds
 * what its events delivered since its `ask` event. It asserts that the open conversation on the turn's session holds the
 * turn once. The transcript cases read a session that branches. The transcript shows the branch from the first turn through
 * `onTurn` to the newest leaf below `onTurn`. It offers the newest other branch at each turn where other branches leave.
 */
import { describe, expect, it } from "vitest";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { anIndividual, type TChatStatus, type TSessionTurn, type TTurnStatus } from "./schemas.js";
import type { TRecord } from "./current-subject.js";
import { question, answer, readBack as aReadBack } from "./page/components/chat-pane.test-fake.js";
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
import { assertTable, pickWith, runSequences, staying as stayingOn } from "@haibun/core/lib/test/machine-table.js";

/** The session's first turn. Its question record names the session. */
const FIRST = "0.1.1";
const SESSION = question(FIRST);
const EMAIL = anIndividual("Email", "a@test.com");
const LEVEL = "private";
/** The records actuality writes for the page's turn. Actuality writes the question record first and the response record second. */
const QUESTION: TRecord = { id: question("0.1.2"), label: COMMENT_LABEL };
const ANSWER: TRecord = { id: answer("0.1.2"), label: COMMENT_LABEL };

/** A turn of the session as the store returns it. Its bundle names the email. */
const readBack = (turn: string, inReplyTo?: string): TSessionTurn => aReadBack(turn, inReplyTo, [EMAIL]);

/** The actions the page delegates to its turn, and a refused call whose action the delegation doesn't hold. */
const DELEGATED = ["Read:private", "Example:ask"];
const REFUSED = { step: "Example-act", action: "Example:act" };
/** A call the page's turn made and the record that call wrote. */
const CALL = { name: "Example-read", ok: true, record: { persistedAs: "ToolCall", id: "tcall-1" } };

/** One event of each type. Each event that takes a session names SESSION. The `ask` event starts a turn in SESSION. That turn replies to the first turn. */
const EVENT: Record<TConversationEventType, TConversationEvent> = {
	open: { type: "open", session: SESSION },
	read: { type: "read", session: SESSION, turns: [readBack(FIRST)] },
	failed: { type: "failed", session: SESSION },
	close: { type: "close" },
	ask: { type: "ask", prompt: "what does this say", patterns: [EMAIL], session: SESSION, inReplyTo: SESSION, delegated: DELEGATED },
	started: { type: "started" },
	text: { type: "text", piece: "an answer" },
	status: { type: "status", line: "generating" },
	context: { type: "context", lines: ["context sent"] },
	called: { type: "called", calls: [CALL] },
	recorded: { type: "recorded", record: QUESTION },
	refused: { type: "refused", call: REFUSED },
	stop: { type: "stop", reason: "you stopped it" },
	ended: { type: "ended" },
	erred: { type: "erred", message: "connection reset" },
};

const after = (conversation: TConversationState, ...events: TConversationEvent[]): TConversationState => events.reduce(transition, conversation);
const run = (...events: TConversationEvent[]): TConversationState => after(CLOSED_CONVERSATION, ...events);
const on = (...types: TConversationEventType[]): TConversationState => run(...types.map((type) => EVENT[type]));
/** Maps every event to `status` except the events `moves` maps. */
const staying = <S extends string>(status: S, moves: Partial<Record<TConversationEventType, S>>) => stayingOn(CONVERSATION_EVENTS, status, moves);
const askedStatus = (conversation: TConversationState): TTurnStatus => conversation.asked?.status ?? "idle";
/** A conversation holding a turn at a status that only actuality records. The page's events don't move a turn to that status. */
const holdingTurnAt = (status: TChatStatus): TConversationState => {
	const running = on("open", "read", "ask", "started");
	return { ...running, asked: { ...(running.asked as NonNullable<TConversationState["asked"]>), status } };
};

/** A conversation at each status before the page sends a turn. */
const AT: Record<TConversationState["status"], TConversationState> = { closed: CLOSED_CONVERSATION, opening: on("open"), open: on("open", "read") };

/** The conversation's transition table. It maps each status and event to the next status while the page doesn't have a turn in flight. */
const TABLE: Record<TConversationState["status"], Record<TConversationEventType, TConversationState["status"]>> = {
	closed: staying("closed", { open: "opening", ask: "open" }),
	opening: staying("opening", { read: "open", failed: "closed", close: "closed" }),
	open: staying("open", { open: "opening", close: "closed" }),
};

/** The open conversation with the page's turn at each status. */
const TURN_AT: Record<TTurnStatus, TConversationState> = {
	idle: on("open", "read"),
	asking: on("open", "read", "ask"),
	running: on("open", "read", "ask", "started"),
	completed: on("open", "read", "ask", "started", "ended"),
	failed: on("open", "read", "ask", "started", "erred"),
	stopped: on("open", "read", "ask", "started", "stop", "erred"),
	// A turn ends unverified when its response names a handle that the context it was sent doesn't hold. Actuality sets that
	// status when it records the turn. The page's events don't move a turn to that status, so `holdingTurnAt` sets it on the
	// page's turn directly.
	unverified: holdingTurnAt("unverified"),
};

/** The transition table of the page's turn. It maps each status and event to the next status for a turn that a reader
 *  didn't stop. The machine refuses a question while a turn is in flight or while the conversation is opening. The `open`
 *  event moves the conversation to opening and leaves the turn's status unchanged. */
const TURN_TABLE: Record<TTurnStatus, Record<TConversationEventType, TTurnStatus>> = {
	idle: staying("idle", { ask: "asking" }),
	asking: staying("asking", { started: "running", ended: "failed", erred: "failed" }),
	running: staying("running", { ended: "completed", erred: "failed" }),
	completed: staying("completed", { ask: "asking" }),
	failed: staying("failed", { ask: "asking" }),
	stopped: staying("stopped", { ask: "asking" }),
	unverified: staying("unverified", { ask: "asking" }),
};

/** Returns the status of the page's turn after an event. It reads TURN_TABLE with two exceptions. An `erred` event moves
 *  an in-flight turn that holds a `stoppedBy` reason to `stopped`. An `ask` event in an opening conversation is refused
 *  and leaves the status unchanged. */
const expectedStatus = (conversation: TConversationState, type: TConversationEventType): TTurnStatus => {
	const status = askedStatus(conversation);
	if (type === "erred" && inFlight(conversation.asked?.status) && conversation.asked?.stoppedBy) return "stopped";
	if (type === "ask" && conversation.status === "opening") return status;
	return TURN_TABLE[status][type];
};

describe("every status and every event", () => {
	const byType = { events: CONVERSATION_EVENTS, event: (type: TConversationEventType) => EVENT[type], transition };
	it("moves a conversation as the table states", () => assertTable(TABLE, AT, { ...byType, statusOf: (conversation) => conversation.status }));
	it("moves the page's turn as the table states", () => assertTable(TURN_TABLE, TURN_AT, { ...byType, statusOf: askedStatus }));

	it("doesn't change a conversation on a request event while its turn isn't in flight", () => {
		for (const status of ["idle", "completed", "failed", "stopped"] as const) {
			for (const type of REQUEST_EVENTS) expect(transition(TURN_AT[status], EVENT[type]), `${status} + ${type}`).toBe(TURN_AT[status]);
		}
	});
});

describe("each move of the conversation", () => {
	it("`open` moves any conversation to opening with the event's session and an empty turn list, and the page's turn keeps running", () => {
		const opened = transition(TURN_AT.running, { type: "open", session: question("0.2.1") });
		expect(opened).toMatchObject({ status: "opening", session: question("0.2.1"), turns: [] });
		expect(opened.asked).toBe(TURN_AT.running.asked);
	});

	it("`read` applies only to the session that is opening or open, so a read that returns after the reader opened another session doesn't change the conversation", () => {
		const moved = transition(AT.opening, { type: "open", session: question("0.2.1") });
		expect(transition(moved, EVENT.read)).toBe(moved);
		expect(transition(AT.closed, EVENT.read)).toBe(AT.closed);
		expect(AT.open.turns).toEqual([{ ...readBack(FIRST), error: "", progress: "", context: [], calls: [] }]);
	});

	it("`read` writes the context and calls of the page's ended turn onto the store's copy of that turn", () => {
		const ended = run(EVENT.open, EVENT.read, EVENT.ask, EVENT.started, EVENT.recorded, EVENT.status, EVENT.context, EVENT.called, EVENT.ended);
		const read = transition(ended, { type: "read", session: SESSION, turns: [readBack(FIRST), { ...readBack("0.1.2", FIRST), response: "the store's answer" }] });
		expect(read.turns.at(-1)).toMatchObject({ askId: question("0.1.2"), response: "the store's answer", progress: "", context: ["context sent"], calls: [CALL] });
	});

	it("`failed` closes the conversation only while its session is opening, `close` closes an opening or open conversation, and both keep the page's turn", () => {
		const opening = transition(TURN_AT.running, EVENT.open);
		expect(transition(opening, EVENT.failed)).toEqual({ ...CLOSED_CONVERSATION, asked: TURN_AT.running.asked });
		expect(transition(TURN_AT.running, EVENT.failed)).toBe(TURN_AT.running);
		expect(transition(TURN_AT.running, EVENT.close)).toEqual({ ...CLOSED_CONVERSATION, asked: TURN_AT.running.asked });
		expect(transition(AT.closed, EVENT.close)).toBe(AT.closed);
	});

	it("`ask` in a closed conversation opens one without a session, and the first record of its turn names the session", () => {
		const first = { ...EVENT.ask, session: undefined, inReplyTo: undefined } as TConversationEvent;
		const asking = run(first, EVENT.started);
		expect(asking).toMatchObject({ status: "open", session: null });
		const recorded = transition(asking, EVENT.recorded);
		expect(recorded).toMatchObject({ status: "open", session: QUESTION.id });
		expect(recorded.turns.map((turn) => turn.askId)).toEqual([QUESTION.id]);
	});

	it("`ask` replaces a turn whose question actuality didn't record, and is refused while a turn is in flight or the conversation is opening", () => {
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
	it("`ask` starts a turn from its prompt, patterns, session, `inReplyTo` and delegated actions, and doesn't keep a field of the previous turn", () => {
		expect(transition(TURN_AT.completed, EVENT.ask).asked).toEqual({
			askId: null,
			prompt: "what does this say",
			response: "",
			bundle: [EMAIL],
			inReplyTo: SESSION,
			// Actuality writes the turn's time when it records the turn. A turn that is still `asking` holds an empty time.
			generatedAtTime: "",
			status: "asking",
			error: "",
			progress: "",
			context: [],
			calls: [],
			session: SESSION,
			stoppedBy: "",
			delegated: DELEGATED,
			refused: [],
		});
	});

	it("`started` moves the turn to running, the first `recorded` event sets its `askId`, and the second sets its `sayId`", () => {
		expect(TURN_AT.running.asked).toMatchObject({ status: "running", askId: null });
		const answered = run(...[EVENT.open, EVENT.read, EVENT.ask, EVENT.started, EVENT.recorded, { type: "recorded", record: ANSWER } as TConversationEvent]);
		expect(answered.asked).toMatchObject({ askId: QUESTION.id, sayId: ANSWER.id });
	});

	it("`text`, `status`, `context`, `called` and `recorded` add to a running turn in order, and don't change a turn that isn't running", () => {
		const answered = run(EVENT.open, EVENT.read, EVENT.ask, EVENT.started, EVENT.text, EVENT.status, EVENT.context, EVENT.recorded, EVENT.text, EVENT.called, EVENT.status, {
			type: "recorded",
			record: ANSWER,
		});
		expect(answered.asked).toMatchObject({
			response: "an answeran answer",
			progress: "generating",
			context: ["context sent"],
			calls: [CALL],
			askId: QUESTION.id,
			sayId: ANSWER.id,
		});
		for (const type of ["text", "status", "context", "called", "recorded"] as const) expect(transition(TURN_AT.asking, EVENT[type]), `asking + ${type}`).toBe(TURN_AT.asking);
	});

	it("`refused` adds each refused action of a running turn once, and doesn't change a turn that isn't running", () => {
		const another = { step: "Example-actAgain", action: REFUSED.action };
		const refused = run(EVENT.open, EVENT.read, EVENT.ask, EVENT.started, EVENT.refused, { type: "refused", call: another });
		expect(refused.asked?.refused, "a person allows an action once for every call that needs it").toEqual([REFUSED]);
		expect(transition(TURN_AT.asking, EVENT.refused)).toBe(TURN_AT.asking);
	});

	it("`stop` keeps the turn in flight with the first reason, and `erred` then ends it as stopped with that reason before the error", () => {
		const stopping = transition(transition(TURN_AT.running, EVENT.stop), { type: "stop", reason: "a second reason" });
		expect(stopping.asked).toMatchObject({ status: "running", stoppedBy: "you stopped it" });
		expect(transition(stopping, EVENT.erred).asked).toMatchObject({ status: "stopped", error: "you stopped it: connection reset" });
		expect(on("open", "read", "ask", "stop", "erred").asked, "a turn stopped before its step started").toMatchObject({
			status: "stopped",
			error: "you stopped it: connection reset",
		});
	});

	it("`erred` fails a turn that a reader didn't stop, and `ended` completes a running turn and fails a turn whose step didn't start", () => {
		expect(TURN_AT.failed.asked).toMatchObject({ status: "failed", error: "connection reset" });
		expect(TURN_AT.completed.asked).toMatchObject({ status: "completed", error: "" });
		expect(on("open", "read", "ask", "ended").asked).toMatchObject({ status: "failed", error: NOT_STARTED });
	});

	it("replaces the store's copy in its session's conversation while it runs and when it ends", () => {
		const running = on("open", "read", "ask", "started", "recorded");
		const readWhileRunning = transition(running, { type: "read", session: SESSION, turns: [readBack(FIRST), { ...readBack("0.1.2", FIRST), response: "", status: "running" }] });
		const pageTurn = (conversation: TConversationState) => conversation.turns.filter((turn) => turn.askId === QUESTION.id);
		expect(pageTurn(readWhileRunning)).toEqual([turnOf(running.asked as TAskedTurn)]);
		expect(pageTurn(transition(readWhileRunning, EVENT.text))[0]).toMatchObject({ status: "running", response: "an answer" });
		expect(pageTurn(transition(transition(readWhileRunning, EVENT.text), EVENT.ended))).toMatchObject([{ status: "completed", response: "an answer" }]);
	});

	it("isn't written into another session or into its own session while that session is opening, and a read places it in the store's order", () => {
		const running = on("open", "read", "ask", "started", "recorded");
		const elsewhere = after(running, { type: "open", session: question("0.2.1") }, { type: "read", session: question("0.2.1"), turns: [readBack("0.2.1")] });
		expect(transition(elsewhere, EVENT.text).turns.map((turn) => turn.askId)).toEqual([question("0.2.1")]);
		const reopening = transition(elsewhere, EVENT.open);
		expect(transition(reopening, EVENT.text).turns, "the text the turn streams while its session is opening").toEqual([]);
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
	it("moves the page's turn only as its table states, the turn holds what its events delivered since its `ask` event, and the conversation on its session holds it once", () => {
		// The fields of the page's turn, recomputed here from the events since the last `ask` event the conversation accepted.
		const unasked = () => ({
			askId: null as string | null,
			sayId: undefined as string | undefined,
			response: "",
			progress: "",
			context: [] as string[],
			calls: [] as (typeof CALL)[],
			stoppedBy: "",
			refused: [] as (typeof REFUSED)[],
		});
		runSequences(
			() => ({ conversation: CLOSED_CONVERSATION, held: unasked() }),
			(at, random, named) => {
				const type = pickWith(random, CONVERSATION_EVENTS);
				const event = EVENT[type];
				const label = named(type);
				const { conversation } = at;
				const wanted = expectedStatus(conversation, type);
				const running = conversation.asked?.status === "running";
				if (event.type === "ask" && !askRefusal(conversation)) at.held = unasked();
				const { held } = at;
				if (event.type === "text" && running) held.response += event.piece;
				if (event.type === "status" && running) held.progress = event.line;
				if (event.type === "context" && running) held.context = [...held.context, ...event.lines];
				if (event.type === "called" && running) held.calls = [...held.calls, ...event.calls];
				if (event.type === "recorded" && running) {
					if (held.askId === null) held.askId = event.record.id;
					else held.sayId = event.record.id;
				}
				if (event.type === "stop" && inFlight(conversation.asked?.status) && !held.stoppedBy) held.stoppedBy = event.reason;
				if (event.type === "refused" && running && !held.refused.some((refused) => refused.action === event.call.action)) held.refused = [...held.refused, event.call];
				at.conversation = transition(conversation, event);
				const moved = at.conversation;
				expect(askedStatus(moved), label).toBe(wanted);
				expect(moved.turns.filter((turn) => turn.askId === null).length, `${label}: at most one turn that a question doesn't name`).toBeLessThanOrEqual(1);
				const { asked } = moved;
				if (!asked) return;
				const { askId, sayId, response, progress, context, calls, stoppedBy, refused } = asked;
				expect({ askId, sayId, response, progress, context, calls, stoppedBy, refused }, label).toEqual(held);
				if (moved.status !== "open" || asked.session !== moved.session) return;
				const holds = moved.turns.filter((turn) => turn.askId === asked.askId);
				expect(holds, `${label}: the conversation holds the page's turn once`).toHaveLength(1);
				if (inFlight(asked.status)) expect(holds, `${label}: as the page holds it while it runs`).toEqual([turnOf(asked)]);
			},
		);
	});
});

describe("the transcript", () => {
	/** The first turn, a reply to it, a reply to that, and a second reply to the first turn, in the store's order. */
	const READ = [readBack(FIRST), readBack("0.1.3", FIRST), readBack("0.1.4", "0.1.3"), readBack("0.1.5", FIRST)];
	const BRANCHED = run(EVENT.open, { type: "read", session: SESSION, turns: READ });
	const shownTurns = (entries: ReturnType<typeof transcript>) => [...new Set(entries.filter((entry) => entry.shown).map((entry) => entry.message.turn ?? "pending"))];
	const answerIn = (entries: ReturnType<typeof transcript>, turn: string) => entries.find((entry) => entry.message.role === "llm" && entry.message.turn === turn)?.message;

	it("lists every turn's question and response, and shows the newest turn's branch when `onTurn` is unset", () => {
		const entries = transcript(BRANCHED, undefined, LEVEL);
		expect(entries).toHaveLength(8);
		expect(shownTurns(entries)).toEqual([SESSION, question("0.1.5")]);
		expect(answerIn(entries, SESSION)?.otherBranch, "the first turn's response offers the other branch by its latest response record").toEqual({
			recordId: answer("0.1.4"),
			turn: question("0.1.4"),
			bundle: { patterns: [EMAIL], accessLevel: LEVEL },
			count: 1,
		});
	});

	it("sets each entry's `askedAt` from its turn's time, and the timeline reads `askedAt` for the reader's place", () => {
		const entries = transcript(BRANCHED, undefined, LEVEL);
		const askedAt = (turn: string) => entries.find((entry) => entry.message.turn === turn)?.askedAt;
		expect(askedAt(SESSION), "the time actuality recorded the question").toBe(Date.parse(readBack(FIRST).generatedAtTime));
		expect(askedAt(question("0.1.5")) ?? 0, "and a later turn holds a later time").toBeGreaterThan(askedAt(SESSION) ?? 0);
	});

	it("shows the branch through `onTurn` and the newest replies below it", () => {
		const older = transcript(BRANCHED, question("0.1.3"), LEVEL);
		expect(shownTurns(older)).toEqual([SESSION, question("0.1.3"), question("0.1.4")]);
		expect(answerIn(older, SESSION)?.otherBranch?.turn, "and offers the newer branch").toBe(question("0.1.5"));
		expect(shownTurns(transcript(BRANCHED, SESSION, LEVEL)), "setting `onTurn` to an earlier turn shows the newest replies below it").toEqual([SESSION, question("0.1.5")]);
	});

	it("shows the page's turn on its `inReplyTo` branch as sending before actuality records its question, and offers both earlier branches", () => {
		const entries = transcript(transition(BRANCHED, EVENT.ask), SESSION, LEVEL);
		expect(shownTurns(entries)).toEqual([SESSION, "pending"]);
		expect(entries.at(-1)?.message).toMatchObject({ role: "llm", status: "asking", spinnerStatus: SENDING, spinnerVisible: true });
		expect(answerIn(entries, SESSION)?.otherBranch?.count).toBe(2);
	});

	it("offers a branch by its latest turn's question when that turn stopped before its response was recorded", () => {
		const stopped = after(BRANCHED, EVENT.ask, EVENT.started, { type: "recorded", record: { id: question("0.1.6"), label: COMMENT_LABEL } }, EVENT.stop, EVENT.erred);
		expect(answerIn(transcript(stopped, question("0.1.4"), LEVEL), SESSION)?.otherBranch).toMatchObject({ recordId: question("0.1.6"), turn: question("0.1.6"), count: 2 });
	});

	it("gives each message its comment record, its turn's bundle and its `inReplyTo` turn, and gives each response its turn's status and error", () => {
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

	it("forks at the start when a session holds two first questions, and the first question shown offers the other branch", () => {
		const again = run(EVENT.open, { type: "read", session: SESSION, turns: [readBack(FIRST), readBack("0.1.2")] });
		const entries = transcript(again, undefined, LEVEL);
		expect(shownTurns(entries), "the newest first question starts the branch shown").toEqual([question("0.1.2")]);
		const firstShown = entries.find((entry) => entry.shown && entry.message.role === "user")?.message;
		expect(firstShown?.otherBranch, "and the shown first question offers the other first question's branch").toMatchObject({ turn: SESSION, count: 1 });
		expect(shownTurns(transcript(again, SESSION, LEVEL)), "setting `onTurn` to the other first question shows its branch").toEqual([SESSION]);
	});

	it("shows every turn of a conversation that never branched and doesn't offer another branch, and doesn't show an entry for a conversation without turns", () => {
		const straight = run(EVENT.open, { type: "read", session: SESSION, turns: [readBack(FIRST), readBack("0.1.2", FIRST)] });
		const entries = transcript(straight, question("0.1.2"), LEVEL);
		expect(entries.every((entry) => entry.shown && !entry.message.otherBranch)).toBe(true);
		expect(transcript(CLOSED_CONVERSATION, undefined, LEVEL)).toEqual([]);
	});
});
