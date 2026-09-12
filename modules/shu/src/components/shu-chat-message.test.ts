// @vitest-environment jsdom
/**
 * Reported: the context and calls a turn was made of rendered below its answer.
 *
 * They come first in time, and a reader weighing an answer reads what it was made of first, so they render above it.
 */
import { describe, expect, it } from "vitest";
import { ChatMessageSchema, ShuChatMessage } from "./shu-chat-message.js";

if (!customElements.get("shu-chat-message")) customElements.define("shu-chat-message", ShuChatMessage);

describe("the order a chat message reads in", () => {
	it("puts the context and calls above the answer", async () => {
		document.body.innerHTML = "";
		const el = new ShuChatMessage();
		el.message = ChatMessageSchema.parse({ id: "m1", role: "llm", text: "an answer", status: "completed", activity: ["context sent: 1 record", "call: GraphStepper-getIndividual"] });
		document.body.appendChild(el);
		await el.updateComplete;
		const activity = el.querySelector(".chat-activity");
		const answer = el.querySelector(".chat-text");
		expect(activity, "the activity is rendered").not.toBeNull();
		expect(answer, "and so is the answer").not.toBeNull();
		expect(activity?.compareDocumentPosition(answer as Node) ?? 0, "the activity precedes the answer").toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});
});
