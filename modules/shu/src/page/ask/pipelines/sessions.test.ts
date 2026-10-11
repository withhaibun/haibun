// @vitest-environment jsdom
/**
 * `followRunningTurns` follows actuality's stream for the turns of the open conversation. The page reads the open
 * conversation's session again when the stream reports a turn's step starting or ending. That read returns each turn that
 * a reader asks on another page.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CHAT_STEP, answer, chatDispatch, question, readBack as aReadBack } from "../components/chat-pane.test-fake.js";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { INITIAL_SUBJECT, SCOPE, currentSubjectState, scopeEntry } from "../../../current-subject.js";
import { carryARun, setupShuTest, type TShuTestHandle } from "../../../test/setup.js";
import { getAvailableSteps } from "../../controllers/registry-controller.js";
import { conversationState, dispatchConversationEvent, followRunningTurns, gainedSince, openConversation } from "../controllers/conversation-controller.js";
import type { TSessionTurn } from "@haibun/core/lib/conversation/domains/conversation.js";

/** The turns the store returns for the session and the number of times the page read the session. */
const read: { turns: TSessionTurn[]; reads: number } = { turns: [], reads: 0 };

const SESSION = question("0.1.1");
/** The lifecycle event actuality emits when a turn's step starts or ends. This page receives only this event for a turn that a reader asks on another page. */
const reportOf = (stage: "start" | "end") => ({ kind: "lifecycle", type: "step", stage, actionName: CHAT_STEP.ask });
/** Waits for the next animation frame and then the next task. The stream delivers its events as a batch in that frame.
 *  The promises that the batch's handler starts settle before that task. */
const batchSettled = async () => {
	await new Promise((resolve) => requestAnimationFrame(resolve));
	await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("the page follows actuality's turns in the open conversation", () => {
	let t: TShuTestHandle;
	beforeEach(() => {
		t = setupShuTest({
			dispatch: chatDispatch((step) => {
				if (step !== CHAT_STEP.session) throw new Error(`the test dispatch doesn't serve ${step}`);
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

	it("reads the session again when actuality reports a turn's step starting, so this page holds a turn that a reader asks on another page", async () => {
		followRunningTurns();
		// A report names the step that sends a turn, which the page reads from actuality's steps first.
		await getAvailableSteps();
		read.turns = [aReadBack("0.1.1"), aReadBack("0.1.2", SESSION)];
		t.emit(reportOf("start"));
		await vi.waitFor(() => expect(conversationState.get().turns).toHaveLength(2));
	});

	it("reads the session again when actuality reports a turn's step ending", async () => {
		followRunningTurns();
		// A report names the step that sends a turn, which the page reads from actuality's steps first.
		await getAvailableSteps();
		read.turns = [aReadBack("0.1.1"), aReadBack("0.1.2", SESSION)];
		t.emit(reportOf("end"));
		await vi.waitFor(() => expect(conversationState.get().turns).toHaveLength(2));
	});

	it("activates the newest comment of another page's turn once a read returns it", async () => {
		followRunningTurns();
		// A report names the step that sends a turn, which the page reads from actuality's steps first.
		await getAvailableSteps();
		read.turns = [aReadBack("0.1.1"), aReadBack("0.1.2", SESSION)];
		t.emit(reportOf("end"));
		await vi.waitFor(() => expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar)?.record).toEqual({ id: answer("0.1.2"), label: COMMENT_LABEL }));
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar)?.turn, "and the entry names that comment's turn").toBe(question("0.1.2"));
	});

	it("`gainedSince` returns the number of turns a session gained since this page last read it, and returns 0 once the reader opens it", async () => {
		expect(gainedSince("cmt-ask-0.9.9", 4), "a page that hasn't opened a session hasn't read its turns").toBe(4);
		read.turns = [aReadBack("0.9.9"), aReadBack("0.9.10", "cmt-ask-0.9.9")];
		await openConversation("cmt-ask-0.9.9", "activate");
		expect(gainedSince("cmt-ask-0.9.9", 2), "a session the reader read doesn't hold a new turn").toBe(0);
		expect(gainedSince("cmt-ask-0.9.9", 5), "and each turn recorded since that read counts as gained").toBe(3);
	});

	it("doesn't read a session while the conversation is closed, so a report doesn't open a conversation", async () => {
		dispatchConversationEvent({ type: "close" });
		followRunningTurns();
		t.emit(reportOf("start"));
		await batchSettled();
		expect(read.reads).toBe(0);
	});
});
