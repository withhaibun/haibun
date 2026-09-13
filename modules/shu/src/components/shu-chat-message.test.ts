// @vitest-environment jsdom
/**
 * A chat message reads in the order its turn was made: what the answer was made of comes before the answer. A question
 * links to the records it carries, so a reader opens what was asked about from the message itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anIndividual, aType } from "../schemas.js";
import { INITIAL_SUBJECT, SCOPE, currentSubjectState, scopeEntry } from "../current-subject.js";
import { SHU_TEST_IDS } from "../test-ids.js";

/** Each reference a click opened: its kind and target. */
const opened: Array<{ kind: string; target: Record<string, unknown> }> = [];
vi.mock("./ref-navigation.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	openRef: (_source: unknown, kind: string, target: Record<string, unknown>) => opened.push({ kind, target }),
}));

const { ChatMessageSchema, ShuChatMessage } = await import("./shu-chat-message.js");
const { ShuRef } = await import("./shu-ref.js");

if (!customElements.get("shu-chat-message")) customElements.define("shu-chat-message", ShuChatMessage);
if (!customElements.get("shu-ref")) customElements.define("shu-ref", ShuRef);

const BUNDLE = { patterns: [anIndividual("Email", "a@test.com"), aType("Email")], accessLevel: "private" };

async function rendered(message: Record<string, unknown>): Promise<HTMLElement> {
	const el = new ShuChatMessage();
	el.message = ChatMessageSchema.parse(message);
	document.body.appendChild(el);
	await el.updateComplete;
	return el;
}

const carried = (el: HTMLElement) =>
	[...el.querySelectorAll(`[data-testid="${SHU_TEST_IDS.APP.CHAT_CARRIES}"] shu-ref`)].map((ref) => ({
		kind: ref.getAttribute("kind"),
		target: JSON.parse(ref.getAttribute("linkTarget") ?? "{}"),
	}));

beforeEach(() => {
	document.body.innerHTML = "";
	opened.length = 0;
	currentSubjectState.set(INITIAL_SUBJECT);
});

describe("the order a chat message reads in", () => {
	it("puts the context and calls above the answer", async () => {
		const el = await rendered({ id: "m1", role: "llm", text: "an answer", status: "completed", activity: ["context sent: 1 record", "call: GraphStepper-getIndividual"] });
		const activity = el.querySelector(".chat-activity");
		const answer = el.querySelector(".chat-text");
		expect(activity, "the activity is rendered").not.toBeNull();
		expect(answer, "and so is the answer").not.toBeNull();
		expect(activity?.compareDocumentPosition(answer as Node) ?? 0, "the activity precedes the answer").toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});
});

describe("what a question carries", () => {
	it("links each record and type its bundle names", async () => {
		const el = await rendered({ id: "q1", role: "user", text: "what is this", bundle: BUNDLE });
		expect(carried(el)).toEqual([
			{ kind: "entity", target: { persistedAs: "Email", id: "a@test.com" } },
			{ kind: "domain", target: { domain: "Email" } },
		]);
	});

	it("links nothing for an answer, or for a question that carries nothing", async () => {
		expect(carried(await rendered({ id: "a1", role: "llm", text: "an answer", bundle: BUNDLE })), "the answer's question carries the bundle").toEqual([]);
		expect(carried(await rendered({ id: "q2", role: "user", text: "anything", bundle: { patterns: [], accessLevel: "opened" } }))).toEqual([]);
		expect(document.querySelectorAll(`[data-testid="${SHU_TEST_IDS.APP.CHAT_CARRIES}"]`), "and renders no empty line").toHaveLength(0);
	});

	it("opens the linked record without selecting the question", async () => {
		const el = await rendered({ id: "q1", role: "user", text: "what is this", seqPath: "0.1.2", recordId: "cmt-ask-0.1.2", bundle: BUNDLE });
		(el.querySelector(`[data-testid="${SHU_TEST_IDS.APP.CHAT_CARRIES}"] shu-ref`) as HTMLElement).click();
		expect(opened).toEqual([{ kind: "entity", target: { persistedAs: "Email", id: "a@test.com" } }]);
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar), "the question is not selected").toBeNull();
		(el.querySelector(".chat-prompt") as HTMLElement).click();
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar)?.record, "a click on the question itself selects it").toEqual({ id: "cmt-ask-0.1.2", label: "Comment" });
	});
});
