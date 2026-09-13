/**
 * The turn machine, held to its table.
 *
 * Every status is paired with every event and asserted against the table, stated a second time here. Each move that
 * changes what a turn holds is asserted on its own. Random event sequences, seeded so a failure replays, then assert
 * that every move is in the table and that what a turn holds is what its events delivered since it was asked.
 */
import { describe, expect, it } from "vitest";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { anIndividual, type TTurnStatus } from "./schemas.js";
import { entryOf, type TRecord } from "./current-subject.js";
import { IDLE_TURN, NOT_STARTED, TURN_EVENTS, transition, inFlight, turnRefusal, type TTurnEvent, type TTurnEventType, type TTurnState } from "./chat-turn.js";
import { pickWith, seededRandom } from "./test/seeded-random.js";

const BUNDLE = entryOf([anIndividual("Email", "a@test.com")], "private").bundle;
const QUESTION: TRecord = { id: "cmt-ask-0.1.2", label: COMMENT_LABEL };

/** One event of each type. */
const EVENT: Record<TTurnEventType, TTurnEvent> = {
	ask: { type: "ask", prompt: "what does this say", bundle: BUNDLE, session: "0.1.1", inReplyTo: "0.1.1" },
	started: { type: "started", seqPath: "0.1.2" },
	text: { type: "text", piece: "an answer" },
	status: { type: "status", line: "context sent" },
	recorded: { type: "recorded", record: QUESTION },
	stop: { type: "stop", reason: "you stopped it" },
	ended: { type: "ended" },
	erred: { type: "erred", message: "connection reset" },
};

const run = (...types: TTurnEventType[]): TTurnState => types.map((type) => EVENT[type]).reduce(transition, IDLE_TURN);
/** The same status for every event but the ones named. */
const staying = (status: TTurnStatus, moves: Partial<Record<TTurnEventType, TTurnStatus>>): Record<TTurnEventType, TTurnStatus> =>
	Object.fromEntries(TURN_EVENTS.map((type) => [type, moves[type] ?? status])) as Record<TTurnEventType, TTurnStatus>;

/** The table: the status each event moves each status to, for a turn no reader stopped. */
const TABLE: Record<TTurnStatus, Record<TTurnEventType, TTurnStatus>> = {
	idle: staying("idle", { ask: "asking" }),
	asking: staying("asking", { started: "running", ended: "failed", erred: "failed" }),
	running: staying("running", { ended: "completed", erred: "failed" }),
	completed: staying("completed", { ask: "asking" }),
	failed: staying("failed", { ask: "asking" }),
	stopped: staying("stopped", { ask: "asking" }),
};

/** A turn at each status. */
const AT: Record<TTurnStatus, TTurnState> = {
	idle: IDLE_TURN,
	asking: run("ask"),
	running: run("ask", "started"),
	completed: run("ask", "started", "ended"),
	failed: run("ask", "started", "erred"),
	stopped: run("ask", "started", "stop", "erred"),
};

/** The status an event moves a turn to: the table's, except that a stopped turn's request rejecting ends it as stopped. */
const expectedStatus = (turn: TTurnState, type: TTurnEventType): TTurnStatus =>
	type === "erred" && turn.status !== "idle" && inFlight(turn.status) && turn.stoppedBy ? "stopped" : TABLE[turn.status][type];

describe("every status and every event", () => {
	for (const status of Object.keys(TABLE) as TTurnStatus[]) {
		it(`moves a turn ${status} as the table states`, () => {
			expect(AT[status].status).toBe(status);
			for (const type of TURN_EVENTS) expect(transition(AT[status], EVENT[type]).status, `${status} + ${type}`).toBe(TABLE[status][type]);
		});
	}

	it("leaves a turn that is not in flight unchanged by every event but ask", () => {
		for (const status of ["idle", "completed", "failed", "stopped"] as const) {
			for (const type of TURN_EVENTS) if (type !== "ask") expect(transition(AT[status], EVENT[type]), `${status} + ${type}`).toBe(AT[status]);
		}
	});
});

describe("each move", () => {
	it("ask starts a turn with the question, its bundle, its session and the turn it replies to, and nothing of the turn before", () => {
		expect(transition(AT.completed, EVENT.ask)).toEqual({
			status: "asking",
			prompt: "what does this say",
			bundle: BUNDLE,
			session: "0.1.1",
			inReplyTo: "0.1.1",
			seqPath: null,
			text: "",
			activity: [],
			recorded: [],
			error: "",
			stoppedBy: "",
		});
	});

	it("started names the turn's seqPath", () => {
		expect(AT.running).toMatchObject({ status: "running", seqPath: "0.1.2" });
	});

	it("text, status and recorded add to a running turn, in order, and to no turn that is not running", () => {
		expect(run("ask", "started", "text", "status", "recorded", "text", "status", "recorded")).toMatchObject({
			text: "an answeran answer",
			activity: ["context sent", "context sent"],
			recorded: [QUESTION, QUESTION],
		});
		for (const status of ["asking", "completed"] as const) {
			for (const type of ["text", "status", "recorded"] as const) expect(transition(AT[status], EVENT[type]), `${status} + ${type}`).toBe(AT[status]);
		}
	});

	it("stop keeps the turn in flight with the first reason, and the request's rejection ends it stopped with that reason first", () => {
		const stopping = transition(transition(AT.running, EVENT.stop), { type: "stop", reason: "a second reason" });
		expect(stopping).toMatchObject({ status: "running", stoppedBy: "you stopped it" });
		expect(transition(stopping, EVENT.erred)).toMatchObject({ status: "stopped", error: "you stopped it: connection reset" });
		expect(run("ask", "stop", "erred"), "a turn stopped before its step started").toMatchObject({ status: "stopped", error: "you stopped it: connection reset" });
	});

	it("erred ends a turn no reader stopped as failed, with what went wrong", () => {
		expect(AT.failed).toMatchObject({ status: "failed", error: "connection reset" });
	});

	it("ended ends a running turn as completed, and a turn whose step never started as failed", () => {
		expect(AT.completed).toMatchObject({ status: "completed", error: "" });
		expect(run("ask", "ended")).toMatchObject({ status: "failed", error: NOT_STARTED });
	});

	it("refuses a new turn only while one is in flight", () => {
		for (const status of Object.keys(TABLE) as TTurnStatus[]) expect(turnRefusal(AT[status]) !== null, status).toBe(status === "asking" || status === "running");
	});
});

describe("any sequence of events", () => {
	it("moves only as the table states, and a turn holds what its events delivered since it was asked", () => {
		for (let seed = 1; seed <= 200; seed++) {
			const random = seededRandom(seed);
			let turn = IDLE_TURN;
			// What the turn holds, stated again from the events since the last ask it took.
			const unasked = () => ({ seqPath: null as string | null, text: "", activity: [] as string[], recorded: [] as TRecord[], stoppedBy: "" });
			let held = unasked();
			const path: string[] = [];
			for (let step = 0; step < 40; step++) {
				const type = pickWith(random, TURN_EVENTS);
				const event = EVENT[type];
				path.push(type);
				const label = `seed ${seed}: ${path.join(" ")}`;
				const wanted = expectedStatus(turn, type);
				const running = turn.status === "running";
				if (event.type === "ask" && !inFlight(turn.status)) held = unasked();
				if (event.type === "started" && turn.status === "asking") held.seqPath = event.seqPath;
				if (event.type === "text" && running) held.text += event.piece;
				if (event.type === "status" && running) held.activity = [...held.activity, event.line];
				if (event.type === "recorded" && running) held.recorded = [...held.recorded, event.record];
				if (event.type === "stop" && inFlight(turn.status) && !held.stoppedBy) held.stoppedBy = event.reason;
				turn = transition(turn, event);
				expect(turn.status, label).toBe(wanted);
				if (turn.status === "idle") continue;
				expect({ seqPath: turn.seqPath, text: turn.text, activity: turn.activity, recorded: turn.recorded, stoppedBy: turn.stoppedBy }, label).toEqual(held);
			}
		}
	});
});
