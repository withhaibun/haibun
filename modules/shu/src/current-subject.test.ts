/**
 * The current-subject machine, held to its table.
 *
 * Every state and event pair is asserted against a second statement of the rules, written here as data rather than
 * read from the module, so the two have to agree. Then random event sequences, seeded so a failure replays, assert
 * what holds whatever order things happen in: the state stays inside the machine, and the events that only carry data
 * never move what the reader is on.
 */
import { describe, expect, it } from "vitest";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { anIndividual, aType } from "./schemas.js";
import {
	INITIAL_SUBJECT,
	READINGS,
	SUBJECT_EVENTS,
	currentSubject,
	nextTurnContext,
	sendRefusal,
	transition,
	type TItem,
	type TReading,
	type TSubjectEvent,
	type TSubjectEventType,
	type TSubjectState,
} from "./current-subject.js";

const EMAIL = { id: "a@test.com", label: "Email" };
const PANE = { patterns: [anIndividual(EMAIL.label, EMAIL.id)], accessLevel: "private" };
const TYPE_PANE = { patterns: [aType("Email")], accessLevel: "private" };
const OTHER_PANE = { patterns: [anIndividual("Email", "b@test.com")], accessLevel: "private" };
const ASK_1: TItem = { id: "cmt-ask-0.-1.3", seqPath: "0.-1.3" };
const SAY_1: TItem = { id: "cmt-say-0.-1.3", seqPath: "0.-1.3" };
const SAY_2: TItem = { id: "cmt-say-0.-1.7", seqPath: "0.-1.7" };

/** One state per reading, each with a pane, a session and (for message) a selection, so every output has data to read. */
const IN: Record<TReading, TSubjectState> = {
	pane: { ...INITIAL_SUBJECT, pane: PANE, latest: SAY_1 },
	latest: { ...INITIAL_SUBJECT, reading: "latest", pane: PANE, latest: SAY_1 },
	message: { ...INITIAL_SUBJECT, reading: "message", pane: PANE, latest: SAY_2, selected: SAY_1 },
};

/** An instance of each event, so the table can be walked. */
const EVENTS: { [T in TSubjectEventType]: Extract<TSubjectEvent, { type: T }> } = {
	openInPane: { type: "openInPane", pane: OTHER_PANE },
	paneClosed: { type: "paneClosed", pane: TYPE_PANE },
	clearSubject: { type: "clearSubject" },
	send: { type: "send" },
	recorded: { type: "recorded", item: SAY_2 },
	turnEnded: { type: "turnEnded" },
	stop: { type: "stop" },
	selectMessage: { type: "selectMessage", item: ASK_1 },
	openSession: { type: "openSession", latest: SAY_2 },
	newSession: { type: "newSession" },
};

/** The rules, stated again: where each event takes each reading. */
const NEXT_READING: Record<TReading, Record<TSubjectEventType, TReading>> = {
	pane: { openInPane: "pane", paneClosed: "pane", clearSubject: "pane", send: "latest", recorded: "pane", turnEnded: "pane", stop: "pane", selectMessage: "message", openSession: "latest", newSession: "pane" },
	latest: { openInPane: "pane", paneClosed: "latest", clearSubject: "pane", send: "latest", recorded: "latest", turnEnded: "latest", stop: "latest", selectMessage: "message", openSession: "latest", newSession: "pane" },
	message: { openInPane: "pane", paneClosed: "message", clearSubject: "pane", send: "latest", recorded: "message", turnEnded: "message", stop: "message", selectMessage: "message", openSession: "latest", newSession: "pane" },
};

describe("every state and event, against the table", () => {
	for (const reading of READINGS) {
		for (const type of SUBJECT_EVENTS) {
			it(`${reading} + ${type} -> ${NEXT_READING[reading][type]}`, () => {
				const next = transition(IN[reading], EVENTS[type]);
				expect(next.reading).toBe(NEXT_READING[reading][type]);
				expect(next.selected !== null, "a selection is held only in the message reading").toBe(next.reading === "message");
			});
		}
	}

	it("carries the data each event names", () => {
		expect(transition(IN.latest, EVENTS.openInPane).pane).toEqual(OTHER_PANE);
		expect(transition(IN.latest, EVENTS.paneClosed).pane, "a pane closing changes what the pane shows, not what the reader is on").toEqual(TYPE_PANE);
		expect(transition(IN.pane, EVENTS.clearSubject).pane.patterns).toEqual([]);
		expect(transition(transition(IN.pane, EVENTS.send), EVENTS.recorded).latest, "a running turn's comment is the session's latest").toEqual(SAY_2);
		expect(transition(IN.pane, EVENTS.selectMessage).selected).toEqual(ASK_1);
		expect(transition(IN.message, EVENTS.openSession).latest).toEqual(SAY_2);
		const fresh = transition(IN.message, EVENTS.newSession);
		expect([fresh.latest, fresh.selected]).toEqual([null, null]);
	});

	it("send fixes what the turn is about from the state it was sent in, and runs the turn", () => {
		const sentFromPane = transition(IN.pane, EVENTS.send);
		expect(sentFromPane.turn).toEqual({ running: true, about: nextTurnContext(IN.pane), ofOpenSession: true });
		const sentFromMessage = transition(IN.message, EVENTS.send);
		expect(sentFromMessage.turn.running && sentFromMessage.turn.about.inReplyTo, "sent with a message selected, the turn replies to that message").toBe(SAY_1.seqPath);
	});

	it("refuses a second question while a turn runs, and changes nothing for it", () => {
		const running = transition(IN.pane, EVENTS.send);
		expect(sendRefusal(running)).not.toBeNull();
		expect(transition(running, EVENTS.send)).toBe(running);
		expect(sendRefusal(transition(running, EVENTS.turnEnded))).toBeNull();
		expect(sendRefusal(transition(running, EVENTS.stop))).toBeNull();
	});

	it("keeps the turn running through everything but its own end", () => {
		const running = transition(IN.pane, EVENTS.send);
		for (const type of SUBJECT_EVENTS) {
			if (type === "turnEnded" || type === "stop") continue;
			expect(transition(running, EVENTS[type]).turn.running, `${type} does not end a turn`).toBe(true);
		}
	});

	it("a turn left for another session keeps running, and what it records is not that session's", () => {
		const running = transition({ ...IN.pane, latest: null }, EVENTS.send);
		for (const leaving of [EVENTS.openSession, EVENTS.newSession]) {
			const left = transition(running, leaving);
			expect(left.turn.running, `${leaving.type} leaves the turn running`).toBe(true);
			const recorded = transition(left, { type: "recorded", item: ASK_1 });
			expect(recorded.latest, `${leaving.type}: the running turn's comment is not the open session's latest`).toEqual(left.latest);
		}
		expect(transition(running, { type: "recorded", item: ASK_1 }).latest, "still in the session it was sent from, it is").toEqual(ASK_1);
	});
});

describe("what each reading answers with", () => {
	it("the current subject is the pane's record, the latest item, or the selected message", () => {
		expect(currentSubject(IN.pane)).toEqual(EMAIL);
		expect(currentSubject({ ...IN.pane, pane: TYPE_PANE }), "a pane about a type is on no record").toBeNull();
		expect(currentSubject(IN.latest)).toEqual({ id: SAY_1.id, label: COMMENT_LABEL });
		expect(currentSubject(IN.message)).toEqual({ id: SAY_1.id, label: COMMENT_LABEL });
	});

	it("between sending and the first recorded comment, the conversation is on what it was sent about", () => {
		const sent = transition({ ...IN.pane, latest: null }, EVENTS.send);
		expect(currentSubject(sent)).toEqual(EMAIL);
		expect(currentSubject(transition(sent, { type: "recorded", item: ASK_1 }))).toEqual({ id: ASK_1.id, label: COMMENT_LABEL });
	});

	it("the next turn's context is the pane's patterns, or the one item it continues from", () => {
		expect(nextTurnContext(IN.pane)).toEqual({ kind: "pane", patterns: PANE.patterns, accessLevel: "private", inReplyTo: SAY_1.seqPath });
		expect(nextTurnContext({ ...IN.pane, latest: null }).inReplyTo, "a first question replies to nothing").toBeUndefined();
		expect(nextTurnContext(IN.latest)).toEqual({ kind: "item", patterns: [anIndividual(COMMENT_LABEL, SAY_1.id)], accessLevel: "private", inReplyTo: SAY_1.seqPath });
		expect(nextTurnContext(IN.message)).toEqual({ kind: "item", patterns: [anIndividual(COMMENT_LABEL, SAY_1.id)], accessLevel: "private", inReplyTo: SAY_1.seqPath });
	});
});

/** A small deterministic generator, so a failing sequence is printed and replays from its seed. */
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 0x1_0000_0000;
	};
}

describe("random sequences, seeded", () => {
	const SEEDS = 200;
	const LENGTH = 40;
	const readingIsMoved = new Set<TSubjectEventType>(["openInPane", "clearSubject", "send", "selectMessage", "openSession", "newSession"]);

	for (let seed = 1; seed <= SEEDS; seed++) {
		it(`seed ${seed}: stays inside the machine, and only a reader's act moves the reader`, () => {
			const random = lcg(seed);
			let state = INITIAL_SUBJECT;
			const trail: TSubjectEventType[] = [];
			for (let i = 0; i < LENGTH; i++) {
				const type = SUBJECT_EVENTS[Math.floor(random() * SUBJECT_EVENTS.length)];
				trail.push(type);
				const before = state;
				state = transition(state, EVENTS[type]);
				const path = trail.join(" > ");
				expect(READINGS, path).toContain(state.reading);
				expect(state.selected !== null, path).toBe(state.reading === "message");
				if (state.turn.running) expect(state.turn.about.kind, `${path}: a running turn was sent about something`).toMatch(/pane|item/);
				if (!readingIsMoved.has(type)) expect(state.reading, `${path}: ${type} does not move the reader`).toBe(before.reading);
				if (type === "paneClosed" && before.reading !== "pane") expect(currentSubject(state), `${path}: a pane closing leaves a conversation's subject`).toEqual(currentSubject(before));
				if (type === "recorded" && before.reading !== "latest") expect(currentSubject(state), `${path}: a recorded comment moves only the latest reading`).toEqual(currentSubject(before));
			}
		});
	}
});
