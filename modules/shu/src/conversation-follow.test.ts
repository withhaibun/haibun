// @vitest-environment jsdom
/**
 * The open conversation follows actuality: a turn any page asks in it reaches every page reading it, when actuality reports
 * that turn's step starting and when it reports it ending.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CHAT_STEP, answer, chatDispatch, question, readBack as aReadBack } from "./components/chat-pane.test-fake.js";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { INITIAL_SUBJECT, SCOPE, currentSubjectState, scopeEntry } from "./current-subject.js";
import { carryARun, setupShuTest, type TShuTestHandle } from "./test-setup.js";
import { ASK_STEP, conversationState, dispatchConversationEvent, followRunningTurns, gainedSince, openConversation } from "./conversation.js";
import type { TSessionTurn } from "./schemas.js";

/** The turns the store reads back for the session, and how many times the page read it. */
const read: { turns: TSessionTurn[]; reads: number } = { turns: [], reads: 0 };

const SESSION = question("0.1.1");
/** What actuality reports for a turn's step, which is what this page hears of a turn another page asked. */
const reportOf = (stage: "start" | "end") => ({ kind: "lifecycle", type: "step", stage, actionName: ASK_STEP });
/** The stream delivers what it was given as a batch in the next frame, and what the batch starts settles before the task after it. */
const batchSettled = async () => {
	await new Promise((resolve) => requestAnimationFrame(resolve));
	await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("the open conversation follows actuality's turns", () => {
	let t: TShuTestHandle;
	beforeEach(() => {
		t = setupShuTest({
			dispatch: chatDispatch((step) => {
				if (step !== CHAT_STEP.session) throw new Error(`unexpected ${step}`);
				read.reads += 1;
				return { turns: read.turns };
			}),
		});
		carryARun();
		read.reads = 0;
		read.turns = [aReadBack("0.1.1")];
		currentSubjectState.set(INITIAL_SUBJECT);
		dispatchConversationEvent({ type: "close" });
		dispatchConversationEvent({ type: "open", session: SESSION });
		dispatchConversationEvent({ type: "read", session: SESSION, turns: read.turns });
	});
	afterEach(() => t.teardown());

	it("reads the session again when actuality reports a turn starting, so a turn another page asks reaches this one", async () => {
		followRunningTurns();
		read.turns = [aReadBack("0.1.1"), aReadBack("0.1.2", SESSION)];
		t.emit(reportOf("start"));
		await vi.waitFor(() => expect(conversationState.get().turns).toHaveLength(2));
	});

	it("reads it again when actuality reports a turn ending", async () => {
		followRunningTurns();
		read.turns = [aReadBack("0.1.1"), aReadBack("0.1.2", SESSION)];
		t.emit(reportOf("end"));
		await vi.waitFor(() => expect(conversationState.get().turns).toHaveLength(2));
	});

	it("makes the newest comment of a turn another page asked the active record once a read brings it, as each comment of the page's own turn is", async () => {
		followRunningTurns();
		read.turns = [aReadBack("0.1.1"), aReadBack("0.1.2", SESSION)];
		t.emit(reportOf("end"));
		await vi.waitFor(() => expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar)?.record).toEqual({ id: answer("0.1.2"), label: COMMENT_LABEL }));
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar)?.turn, "with the turn it is a record of").toBe(question("0.1.2"));
	});

	it("names what a session gained since this page read it, and names zero once the reader opens it", async () => {
		expect(gainedSince("cmt-ask-0.9.9", 4), "a page that never opened a session hasn't read a turn of it").toBe(4);
		read.turns = [aReadBack("0.9.9"), aReadBack("0.9.10", "cmt-ask-0.9.9")];
		await openConversation("cmt-ask-0.9.9", "activate");
		expect(gainedSince("cmt-ask-0.9.9", 2), "a session the reader read doesn't hold a new turn").toBe(0);
		expect(gainedSince("cmt-ask-0.9.9", 5), "and what another page asked since is what it gained").toBe(3);
	});

	it("doesn't read a session where a conversation isn't open, so a report never opens one", async () => {
		dispatchConversationEvent({ type: "close" });
		followRunningTurns();
		t.emit(reportOf("start"));
		await batchSettled();
		expect(read.reads).toBe(0);
	});
});
