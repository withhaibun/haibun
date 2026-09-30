// @vitest-environment jsdom
/**
 * A chat message reads in the order its turn was made: what the answer was made of comes before the answer. A question
 * links to the records it carries, so a reader opens what was asked about from the message itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anIndividual, aType } from "../schemas.js";
import { INITIAL_SUBJECT, SCOPE, currentSubjectState, scopeEntry } from "../current-subject.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { PaneState } from "../pane-state.js";
import { followPaneLink } from "./ref-navigation.js";
import { ChatMessageSchema, ShuChatMessage } from "./shu-chat-message.js";
import { SHU_EVENT } from "../consts.js";
import "./shu-ref-element.js";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { REF_DENOTES, markdownRef } from "@haibun/core/lib/typed-links.js";
import { setSiteMetadata } from "../rels-cache.js";

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
	currentSubjectState.set(INITIAL_SUBJECT);
	document.addEventListener("click", followPaneLink, { capture: true });
});
afterEach(() => document.removeEventListener("click", followPaneLink, { capture: true }));

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

	it("doesn't link a record for an answer, or for a question that doesn't carry one", async () => {
		expect(carried(await rendered({ id: "a1", role: "llm", text: "an answer", bundle: BUNDLE })), "the answer's question carries the bundle").toEqual([]);
		expect(carried(await rendered({ id: "q2", role: "user", text: "anything", bundle: { patterns: [], accessLevel: "opened" } }))).toEqual([]);
		expect(document.querySelectorAll(`[data-testid="${SHU_TEST_IDS.APP.CHAT_CARRIES}"]`), "and doesn't render an empty line").toHaveLength(0);
	});

	it("opens the linked record without selecting the question", async () => {
		const el = await rendered({ id: "q1", role: "user", text: "what is this", turn: "cmt-ask-0.1.2", recordId: "cmt-ask-0.1.2", bundle: BUNDLE });
		const opened = vi.spyOn(PaneState, "requestFrom").mockImplementation(() => undefined);
		el.querySelector(`[data-testid="${SHU_TEST_IDS.APP.CHAT_CARRIES}"] shu-ref`)?.shadowRoot?.querySelector("a")?.click();
		expect(opened.mock.calls.map(([, pane]) => pane)).toEqual([{ paneType: "entity", persistedAs: "Email", id: "a@test.com" }]);
		opened.mockRestore();
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar), "the question is not selected").toBeNull();
		(el.querySelector(".chat-prompt") as HTMLElement).click();
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar)?.record, "a click on the question itself selects it").toEqual({ id: "cmt-ask-0.1.2", label: "Comment" });
	});
});

describe("a question's controls", () => {
	it("ask it again, or put it in the input, replying where it replied, without selecting it", async () => {
		const el = await rendered({ id: "q2", role: "user", text: "what is this", turn: "cmt-ask-0.1.2", recordId: "cmt-ask-0.1.2", inReplyTo: "cmt-ask-0.1.1", bundle: BUNDLE });
		const raised: unknown[] = [];
		const hear = (e: Event) => raised.push((e as CustomEvent).detail);
		document.addEventListener(SHU_EVENT.QUESTION_RESTATE, hear);
		for (const control of [SHU_TEST_IDS.APP.CHAT_ASK_AGAIN, SHU_TEST_IDS.APP.CHAT_EDIT]) (el.querySelector(`[data-testid="${control}"]`) as HTMLButtonElement).click();
		document.removeEventListener(SHU_EVENT.QUESTION_RESTATE, hear);
		const asked = { prompt: "what is this", patterns: BUNDLE.patterns, inReplyTo: "cmt-ask-0.1.1" };
		expect(raised).toEqual([
			{ ...asked, send: true },
			{ ...asked, send: false },
		]);
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar), "the question is not selected").toBeNull();
	});

	it("are icons under the icon of the person who asked, each named for what it does", async () => {
		const el = await rendered({ id: "q4", role: "user", text: "what is this", turn: "cmt-ask-0.1.4", recordId: "cmt-ask-0.1.4", bundle: BUNDLE });
		const named = [SHU_TEST_IDS.APP.CHAT_ASK_AGAIN, SHU_TEST_IDS.APP.CHAT_EDIT].map((control) =>
			el.querySelector(`.msg-label [data-testid="${control}"]`)?.getAttribute("aria-label"),
		);
		expect(named).toEqual(["Ask again", "Edit and ask"]);
	});

	it("are on a recorded question only", async () => {
		const answer = await rendered({ id: "a3", role: "llm", text: "an answer", recordId: "cmt-say-0.1.2" });
		const unrecorded = await rendered({ id: "q3", role: "user", text: "not yet recorded" });
		for (const el of [answer, unrecorded]) expect(el.querySelector(`[data-testid="${SHU_TEST_IDS.APP.CHAT_ASK_AGAIN}"]`)).toBeNull();
	});
});

describe("the records a message names", () => {
	const TOOL_CALL = "ToolCall";
	const [CALL_ID, CALLED] = ["tcall-1", "GraphStepper-getIndividualWithEdges answered"];
	const refs = (root: ParentNode) => [...root.querySelectorAll("shu-ref")].map((ref) => [ref.getAttribute("kind"), JSON.parse(ref.getAttribute("linkTarget") ?? "{}")]);

	beforeEach(() => {
		setSiteMetadata({
			types: [COMMENT_LABEL, TOOL_CALL],
			idFields: { [COMMENT_LABEL]: "id", [TOOL_CALL]: "id" },
			rels: { [COMMENT_LABEL]: {}, [TOOL_CALL]: {} },
			edgeRanges: {},
			properties: { [COMMENT_LABEL]: ["id"], [TOOL_CALL]: ["id"] },
			queryable: {},
			validTimeFields: {},
			summary: {},
			ui: {},
			propertyDefinitions: {},
		});
	});

	it("links the Comment actuality recorded for it from its label", async () => {
		const el = await rendered({ id: "q1", role: "user", text: "what is this", recordId: "ask-1" });
		const label = el.querySelector(`[data-testid="${SHU_TEST_IDS.APP.CHAT_RECORD}"]`);
		expect(label && JSON.parse(label.getAttribute("linkTarget") ?? "{}")).toEqual({ persistedAs: COMMENT_LABEL, id: "ask-1" });
	});

	it("links the record of a call its activity names, and its spinner shows the words that name it", async () => {
		const line = markdownRef(CALLED, TOOL_CALL, CALL_ID);
		const el = await rendered({ id: "a1", role: "llm", status: "running", activity: [line], spinnerStatus: line, spinnerVisible: true });
		const activity = el.querySelector(`[data-testid="${SHU_TEST_IDS.APP.CHAT_ACTIVITY}"]`) as ParentNode;
		expect(refs(activity)).toEqual([[REF_DENOTES.individual, { persistedAs: TOOL_CALL, id: CALL_ID }]]);
		expect((el.querySelector("shu-spinner") as HTMLElement & { status?: string }).status).toBe(CALLED);
	});
});
