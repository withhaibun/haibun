// @vitest-environment jsdom
/**
 * The history follows the newest turn, holds a reader's place once they scroll away, and states what arrived after it
 * on a control that returns them to the newest.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { question, readBack } from "./chat-pane.test-fake.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { setupShuTest } from "../test-setup.js";
import { conversationState, dispatchConversationEvent } from "../conversation.js";
import { ShuActivityHistory } from "./shu-activity-history.js";
import { timeCursor } from "../signals.js";

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

/** The turns the run holds, as a session read states them. */
function alsoAsked(at: number): void {
	const turns = [...conversationState.get().turns.map((turn) => ({ ...turn, askId: turn.askId ?? "" })), readBack(`0.1.${at}`, `0.1.${at - 1}`)];
	dispatchConversationEvent({ type: "read", session: SESSION, turns });
}

describe("the actions bar's history", () => {
	let teardown: () => void;
	beforeEach(() => {
		teardown = setupShuTest().teardown;
		timeCursor.set(null);
	});

	it("states nothing to return to while it follows the newest turn", async () => {
		const history = await aHistory(2);
		expect(arrivedIn(history)?.hidden, "a reader at the newest turn has nothing to return to").toBe(true);
	});

	it("states the turns asked after a reader's place, and states none once they return to the newest", async () => {
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

	afterEach(() => teardown());
});
