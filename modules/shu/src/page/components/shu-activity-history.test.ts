// @vitest-environment jsdom
/**
 * The history follows the newest turn, holds a reader's place once they scroll away, and states what arrived after it
 * on a control that returns them to the newest.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { question, readBack } from "../ask/components/chat-pane.test-fake.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { setupShuTest } from "../../test/setup.js";
import { conversationState, dispatchConversationEvent } from "../ask/controllers/conversation-controller.js";
import { ShuActivityHistory } from "./shu-activity-history.js";
import { timeCursor } from "../controllers/page-cell-controller.js";

const SESSION = question("0.1.1");
const arrivedIn = (history: ShuActivityHistory) => history.querySelector<HTMLElement>(`[data-testid="${SHU_TEST_IDS.APP.CHAT_ARRIVED}"]`);

/** A history mounted on a session of `turns` turns, with its own scroller standing in for a browser's. */
async function aHistory(turns: number): Promise<ShuActivityHistory> {
	dispatchConversationEvent({ type: "close" });
	dispatchConversationEvent({ type: "open", session: SESSION });
	dispatchConversationEvent({ type: "read", session: SESSION, turns: Array.from({ length: turns }, (_, at) => readBack(`0.1.${at + 1}`, at === 0 ? undefined : `0.1.${at}`)) });
	const history = new ShuActivityHistory();
	document.body.replaceChildren(history);
	await history.updateComplete;
	return history;
}

/** The turns actuality holds, as a session read states them. */
function alsoAsked(at: number): void {
	const turns = [...conversationState.get().turns.map((turn) => ({ ...turn, askId: turn.askId ?? "" })), readBack(`0.1.${at}`, `0.1.${at - 1}`)];
	dispatchConversationEvent({ type: "read", session: SESSION, turns });
}

describe("the actions bar's history", () => {
	let teardown: () => void;
	beforeEach(() => {
		location.hash = "";
		teardown = setupShuTest().teardown;
		timeCursor.set(null);
	});

	it("doesn't state a place to return to while it follows the newest turn", async () => {
		const history = await aHistory(2);
		expect(arrivedIn(history)?.hidden, "a reader at the newest turn doesn't have a place to return to").toBe(true);
	});

	it("states the turns asked after a reader's place, and doesn't state one once they return to the newest", async () => {
		const history = await aHistory(2);
		history.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
		alsoAsked(3);
		await history.updateComplete;
		const control = arrivedIn(history);
		expect(control?.hidden, "a reader reading where they are is told a turn arrived").toBe(false);
		expect(control?.textContent, "one turn, counted as turns rather than messages").toContain("1 turn");
		control?.click();
		await history.updateComplete;
		expect(arrivedIn(history)?.hidden, "and pressing it returns them to the newest").toBe(true);
	});

	it("tracks the latest position as a running turn streams text while following, and holds the reader's place when wheeled up", async () => {
		const history = await aHistory(1);
		let height = 200;
		Object.defineProperty(history, "scrollHeight", { get: () => height, configurable: true });
		Object.defineProperty(history, "clientHeight", { get: () => 100, configurable: true });
		history.scrollTop = 100;

		dispatchConversationEvent({ type: "ask", prompt: "Explain the graph", patterns: [], session: SESSION, inReplyTo: SESSION, delegated: [] });
		dispatchConversationEvent({ type: "started" });
		height = 320;
		dispatchConversationEvent({ type: "text", piece: "First paragraph of the response.\n\n" });
		await history.updateComplete;
		expect(history.scrollTop, "streaming text while following pins scrollTop to scrollHeight").toBe(320);

		height = 460;
		dispatchConversationEvent({ type: "text", piece: "Second paragraph of the response." });
		await history.updateComplete;
		expect(history.scrollTop, "subsequent chunks keep scrollTop at the growing scrollHeight").toBe(460);

		history.scrollTop = 120;
		history.dispatchEvent(new WheelEvent("wheel", { deltaY: -80 }));
		height = 600;
		dispatchConversationEvent({ type: "text", piece: "\n\nThird paragraph after the reader scrolled up." });
		await history.updateComplete;
		expect(history.scrollTop, "streaming chunks do not move scrollTop after the reader wheels up").toBe(120);
	});

	it("tracks appended step results while following and reports arrived entries when paused", async () => {
		const history = await aHistory(1);
		let height = 250;
		Object.defineProperty(history, "scrollHeight", { get: () => height, configurable: true });
		Object.defineProperty(history, "clientHeight", { get: () => 100, configurable: true });
		history.scrollTop = 150;

		const stepEntry = document.createElement("div");
		height = 400;
		history.append(stepEntry);
		await history.updateComplete;
		expect(history.scrollTop, "appending a step caller while following scrolls to the new bottom").toBe(400);

		history.scrollTop = 80;
		history.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
		const laterStepEntry = document.createElement("div");
		laterStepEntry.dataset.entryAt = String(Date.now() + 5000);
		height = 550;
		history.append(laterStepEntry);
		await history.updateComplete;
		expect(history.scrollTop, "appending while paused preserves the reader's scroll position").toBe(80);
		expect(arrivedIn(history)?.hidden, "arrived control appears for the new entry").toBe(false);
	});

	afterEach(() => teardown());
});
