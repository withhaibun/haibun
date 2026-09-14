// @vitest-environment jsdom
/**
 * The ask pane and the activity history over the page's turn and conversation, rendered in jsdom against a stream a case
 * holds open and finishes, and a store read a case answers.
 *
 * The pane sends a question from the active record and the conversation, and shows beside its input why a question is
 * refused. The history renders the transcript, so the conversation outlives the pane the actions bar removes when it
 * closes. A session is read back from the store, a new conversation leaves it, and the view hash addresses it. A turn of
 * the conversation activates the actions bar's scope with each comment it records.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { TChatMessage } from "./shu-chat-message.js";
import { anIndividual } from "../schemas.js";
import { readBack, type TDriven as Driven } from "./chat-pane.test-fake.js";

// Partial: the registry's own reads are answered here, and everything else it exports stays itself, so a module that
// reaches for one of them is not left with a rejected import.
vi.mock("../rpc-registry.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), ...(await import("./chat-pane.test-fake.js")).rpcRegistry }));
vi.mock("../rels-cache.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), getActionBarChatExtensionTags: () => [] }));
/** What the pane's view data harvest returns, so a case reads whether a turn sent it. */
const VIEW_DATA = [{ "@id": "view:the-active-pane" }];
vi.mock("../chat-context-harvest.js", () => ({ harvestChatViewLd: () => VIEW_DATA }));
/** What the turn states about itself before it writes anything. */
const stated: string[] = [];
/** What the stream fails with, where it does; unset leaves it open. */
let streamFails: string | undefined;
/** The context envelope each turn was sent with, so a case reads what the pane asked for. */
const sent: Array<{ contextReadBy?: string; patterns?: unknown[]; inReplyTo?: string; viewLd?: unknown[]; sessionSeqPath?: string; target?: string }> = [];
/** The comments the turn records as its step starts, named on the stream as the server names them. */
const recorded: string[] = [];
/** The comments the stream names when a case finishes it, after the turn has run for a while. */
const recordedOnFinish: string[] = [];
/** The seqPath each turn the stream starts is given, in order; a turn beyond them is given 0.1.2. */
const turnSeqPaths: number[][] = [];
/** The running stream's abort signal, how a case streams a piece of the answer, and its finish function. */
const stream: { signal: AbortSignal | undefined; piece: ((text: string) => void) | undefined; finish: (() => void) | undefined } = {
	signal: undefined,
	piece: undefined,
	finish: undefined,
};

/** A session the store holds: its first turn, as the store reads it back. */
const RESTORED = "0.1.1";
const RESTORED_RECORD = anIndividual("Email", "restored@bakery.test");
/** The turns the store reads back for a session, and the answer to the read a case holds open. */
let sessionTurns: unknown[] = [];
let answerSessionRead: ((failure?: string) => void) | undefined;

vi.mock("../hypermedia.js", async () => {
	const { hypermedia } = await import("./chat-pane.test-fake.js");
	return hypermedia(
		(req) => {
			// The registry as the server holds it: a model states who reads its context, which the pane shows on the default.
			if (req.method === "showKihans") return { vertices: [{ id: "openai:a-model", displayName: "a model", capabilities: { tools: true } }] };
			if (req.method === "listChatSessions") return { sessions: [{ sessionSeqPath: RESTORED, label: "an earlier conversation", generatedAtTime: "2026-05-17T05:00:00.000Z" }] };
			// A read held open, answered when a case says the store got back to the page.
			if (req.method === "loadChatSession")
				return new Promise((resolve, reject) => {
					answerSessionRead = (failure) => (failure ? reject(new Error(failure)) : resolve({ turns: sessionTurns }));
				});
			return {};
		},
		(req, onChunk, opts) => {
			opts.onStart?.(turnSeqPaths.shift() ?? [0, 1, 2]);
			sent.push({ ...JSON.parse(String(req.params?.context ?? "{}")), target: String(req.params?.target) });
			for (const id of recorded) onChunk({ recorded: { persistedAs: "Comment", id } });
			for (const status of stated) onChunk({ status });
			if (streamFails) return Promise.reject(new Error(streamFails));
			// An aborted stream rejects, as the fetch that carries it does. A case finishes the stream with the reply text.
			stream.signal = opts.signal;
			return new Promise<void>((resolve, reject) => {
				opts.signal?.addEventListener("abort", () => reject(new Error("the stream was aborted")), { once: true });
				stream.piece = (text) => onChunk({ text });
				stream.finish = () => {
					for (const id of recordedOnFinish) onChunk({ recorded: { persistedAs: "Comment", id } });
					onChunk({ text: "an answer" });
					resolve();
				};
			});
		},
	);
});

const { ShuCombobox } = await import("./shu-combobox.js");
if (!customElements.get("shu-combobox")) customElements.define("shu-combobox", ShuCombobox);
const { ShuActivityHistory } = await import("./shu-activity-history.js");
const { ShuKihanChat, NEW_CONVERSATION } = await import("./shu-kihan-chat.js");
const { IDLE_TURN, dispatchTurnEvent, turnRefusal, turnState } = await import("../chat-turn.js");
const { CLOSED_CONVERSATION, CONVERSATION_OPENING, conversationState, openConversation } = await import("../conversation.js");
const { CONVERSATION_PARAM } = await import("../consts.js");
const { SHU_TAG } = await import("../consts.js");
const { SHU_TEST_IDS } = await import("../test-ids.js");
const { forgetElementPrefs } = await import("../element-prefs.js");
const { hashParam } = await import("../view-hash.js");
const { INITIAL_SUBJECT, SCOPE, activeEntry, currentSubject, currentSubjectState, dispatchSubjectEvent, entryOf, scopeEntry } = await import("../current-subject.js");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const EMAIL = entryOf([anIndividual("Email", "read-me@bakery.test")], "private");
const OTHER = entryOf([anIndividual("Email", "other@bakery.test")], "private");

// The machines are module state shared by every case. Each case starts with no turn in flight, no conversation and no
// active record, because a turn left running refuses the next case's question.
beforeEach(async () => {
	dispatchTurnEvent({ type: "stop", reason: "the case ended" });
	await settle();
	turnState.set(IDLE_TURN);
	conversationState.set(CLOSED_CONVERSATION);
	currentSubjectState.set(INITIAL_SUBJECT);
	for (const list of [stated, sent, recorded, recordedOnFinish, turnSeqPaths]) list.length = 0;
	streamFails = undefined;
	stream.signal = undefined;
	stream.piece = undefined;
	stream.finish = undefined;
	sessionTurns = [readBack(RESTORED, undefined, [RESTORED_RECORD])];
	answerSessionRead = undefined;
	forgetElementPrefs(SHU_TAG.KIHAN_CHAT, "");
	document.body.innerHTML = "";
});

/** The bar's history and its ask pane, as the bar renders them. */
async function aPage(): Promise<{ pane: Driven; history: HTMLElement }> {
	const history = new ShuActivityHistory();
	document.body.appendChild(history);
	const pane = await aPane();
	return { pane, history };
}

/** An ask pane, as the bar builds one each time it opens. */
async function aPane(): Promise<Driven> {
	const pane = new ShuKihanChat() as unknown as Driven;
	document.body.appendChild(pane);
	await pane.updateComplete;
	await settle();
	return pane;
}

/** The element the selector addresses inside the root, or a failure naming the one missing. */
function inside<T extends Element>(root: ParentNode | null | undefined, selector: string): T {
	const found = root?.querySelector<T>(selector);
	if (!found) throw new Error(`nothing addresses ${selector}`);
	return found;
}
const chatInput = (pane: Driven) => inside<HTMLTextAreaElement>(pane.shadowRoot, ".chat-input");
const refusalOn = (pane: Driven) => pane.shadowRoot?.querySelector(".refusal")?.textContent ?? null;
const hidden = (pane: Driven, selector: string) => inside<HTMLElement>(pane.shadowRoot, selector).style.display === "none";
const reading = (pane: Driven) => inside<HTMLSelectElement>(pane.shadowRoot, ".context-read");
const onHistory = (history: HTMLElement) => Array.from(history.querySelectorAll(":scope > shu-chat-message")) as Array<HTMLElement & { message: TChatMessage }>;
const answers = (history: HTMLElement) => onHistory(history).filter((el) => el.message.role === "llm");
const turnsShown = (history: HTMLElement) => [
	...new Set(
		onHistory(history)
			.filter((el) => !el.hidden)
			.map((el) => el.message.seqPath ?? "pending"),
	),
];
const pickSession = (pane: Driven, value: string) => inside(pane.shadowRoot, ".session-select").dispatchEvent(new CustomEvent("combo-change", { detail: { value } }));

/** Type the question and submit it, as a reader does, and let the turn start. */
async function submit(pane: Driven, prompt: string): Promise<void> {
	chatInput(pane).value = prompt;
	pane.submitChat();
	await settle();
	await pane.updateComplete;
}

/** Answer the session read the page is waiting on. */
async function answerTheSessionRead(failure?: string): Promise<void> {
	await settle();
	if (!answerSessionRead) throw new Error("the page made no session read to answer");
	answerSessionRead(failure);
	await settle();
}

describe("a question refused", () => {
	it("while a turn is in flight, says so beside the input, keeps the question, and offers Stop rather than Send", async () => {
		const { pane, history } = await aPage();
		await submit(pane, "what do these have in common");
		await submit(pane, "which one mentions the crumb");
		expect(refusalOn(pane)).toBe(turnRefusal(turnState.get()));
		expect(chatInput(pane).value).toBe("which one mentions the crumb");
		expect(
			onHistory(history).filter((el) => el.message.role === "user"),
			"the refused question is not sent",
		).toHaveLength(1);
		expect(hidden(pane, ".send-btn")).toBe(true);
		expect(hidden(pane, ".stop-btn")).toBe(false);
	});

	it("while the conversation opens, says so beside the input and sends nothing", async () => {
		const { pane } = await aPage();
		pickSession(pane, RESTORED);
		await submit(pane, "and what came of it");
		expect(refusalOn(pane)).toBe(CONVERSATION_OPENING);
		expect(sent).toHaveLength(0);
		await answerTheSessionRead();
		await pane.updateComplete;
		expect(refusalOn(pane), "and the refusal goes once the turns are shown").toBeNull();
	});
});

describe("a turn that ends before it answered", () => {
	it("says what went wrong on its answer, and nothing is left spinning", async () => {
		streamFails = "the model did not answer: connection reset";
		const { pane, history } = await aPage();
		await submit(pane, "what do these have in common");
		const [answer] = answers(history);
		expect(answer.message.error).toContain("connection reset");
		expect(answer.message.status).toBe("failed");
		expect(answer.message.spinnerVisible).toBe(false);
	});

	it("names a reader's own stop as theirs, with what ended the stream beside it", async () => {
		const { pane, history } = await aPage();
		await submit(pane, "what do these have in common");
		inside<HTMLButtonElement>(pane.shadowRoot, ".stop-btn").click();
		await settle();
		expect(stream.signal?.aborted).toBe(true);
		expect(answers(history)[0].message.error).toBe("you stopped it: the stream was aborted");
		expect(turnState.get().status).toBe("stopped");
	});
});

describe("the model a question is sent to", () => {
	it("is one the run offers: a remembered model it no longer offers, as one stored under a provider since renamed, is replaced by the first offered", async () => {
		const { pane } = await aPage();
		pane.setState({ model: "llama:thinker" });
		await submit(pane, "what is this");
		expect(sent.at(-1)?.target).toBe("openai:a-model");
		expect(inside<HTMLElement & { value?: string }>(pane.shadowRoot, ".model-select").value, "and the selector shows the model the question went to").toBe("openai:a-model");
	});
});

describe("who reads the context", () => {
	it("stands at the model's default, named by what the model states, and the turn carries nothing about it", async () => {
		const { pane } = await aPage();
		await submit(pane, "what do these have in common");
		expect(reading(pane).value).toBe("");
		expect(reading(pane).options[0].text).toBe("model default (sends tool cues)");
		expect(sent.at(-1)?.contextReadBy).toBeUndefined();
	});

	it("carries what a reader states", async () => {
		const { pane } = await aPage();
		reading(pane).value = "model";
		reading(pane).dispatchEvent(new Event("change"));
		await submit(pane, "and now with the model reading it");
		expect(sent.at(-1)?.contextReadBy).toBe("model");
		expect(reading(pane).value).toBe("model");
	});
});

describe("what a turn states about itself", () => {
	it("is kept on its answer in order, and the spinner shows the latest", async () => {
		stated.push("context sent:\nEmail -> total -> 2", "dispatching GraphStepper-graphQuery, reading the emails", "generated 40 chars");
		const { pane, history } = await aPage();
		await submit(pane, "what do these have in common");
		expect(answers(history)[0].message.activity).toEqual(stated);
		expect(answers(history)[0].message.spinnerStatus).toBe("generated 40 chars");
	});

	it("moves its answer once for the pieces the stream brings within a frame, and keeps what the stream ends on", async () => {
		const { pane, history } = await aPage();
		await submit(pane, "what do these have in common");
		const moves: string[] = [];
		const unsubscribe = turnState.subscribe((turn, before) => {
			if (turn.status !== "idle" && before.status !== "idle" && turn.text !== before.text) moves.push(turn.text);
		});
		stream.piece?.("crumb ");
		stream.piece?.("and dough, ");
		expect(moves, "no move before the frame is drawn").toEqual([]);
		await new Promise((resolve) => requestAnimationFrame(resolve));
		stream.piece?.("then ");
		stream.finish?.();
		await settle();
		unsubscribe();
		expect(moves).toEqual(["crumb and dough, ", "crumb and dough, then an answer"]);
		expect(answers(history)[0].message).toMatchObject({ status: "completed", text: "crumb and dough, then an answer" });
	});
});

describe("the ask and the active record", () => {
	it("sends the bundle of the record the page activated, with the pane's view data, and replies to nothing yet", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		const { pane } = await aPage();
		await submit(pane, "what does this say");
		expect(sent.at(-1)).toMatchObject({ patterns: EMAIL.bundle.patterns, viewLd: VIEW_DATA });
		expect(sent.at(-1)?.inReplyTo).toBeUndefined();
		expect(sent.at(-1)?.sessionSeqPath).toBeUndefined();
	});

	it("activates each comment its turn records with the turn's bundle, and the comment leads while the bar is open", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		recorded.push("cmt-ask-0.1.2");
		const { pane } = await aPage();
		await submit(pane, "what does this say");
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar)).toEqual({ record: { id: "cmt-ask-0.1.2", label: "Comment" }, seqPath: "0.1.2", bundle: EMAIL.bundle });
		expect(currentSubject(currentSubjectState.get())).toEqual({ id: "cmt-ask-0.1.2", label: "Comment" });
		dispatchSubjectEvent({ type: "close", scope: SCOPE.actionsBar });
		expect(currentSubject(currentSubjectState.get()), "the bar closed: the page's record again").toEqual(EMAIL.record);
	});

	it("replies to the bar's turn and carries its bundle, with no view data, so a selected earlier message branches there", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: { record: { id: "cmt-say-0.1.1", label: "Comment" }, seqPath: "0.1.1", bundle: OTHER.bundle } });
		const { pane } = await aPage();
		await submit(pane, "and what came of it");
		expect(sent.at(-1)).toMatchObject({ inReplyTo: "0.1.1", patterns: OTHER.bundle.patterns, viewLd: [] });
	});

	it("selecting a message makes its comment the active record, and marks that message alone current", async () => {
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		recorded.push("cmt-ask-0.1.2");
		const { pane, history } = await aPage();
		await submit(pane, "what does this say");
		stream.finish?.();
		await settle();
		const question = history.querySelector(":scope > shu-chat-message[data-record='cmt-ask-0.1.2']") as HTMLElement;
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		inside<HTMLElement>(question, ".msg").click();
		expect(currentSubject(currentSubjectState.get())).toEqual({ id: "cmt-ask-0.1.2", label: "Comment" });
		expect(question.getAttribute("aria-current")).toBe("true");
		expect(history.querySelectorAll("[aria-current]")).toHaveLength(1);
	});
});

describe("a conversation", () => {
	it("opens on its first turn, which the view hash then addresses, and the next question belongs to it", async () => {
		turnSeqPaths.push([0, 1, 5]);
		recordedOnFinish.push("cmt-ask-0.1.5", "cmt-say-0.1.5");
		const { pane } = await aPage();
		await submit(pane, "what do these have in common");
		expect(conversationState.get()).toMatchObject({ status: "open", session: "0.1.5" });
		expect(hashParam(CONVERSATION_PARAM)).toBe("0.1.5");
		stream.finish?.();
		await settle();
		await submit(pane, "and what came of it");
		expect(sent.at(-1)).toMatchObject({ sessionSeqPath: "0.1.5", inReplyTo: "0.1.5" });
	});

	it("outlives the pane: a turn left running when the bar closes ends, the history shows its answer, and the next pane continues the session", async () => {
		turnSeqPaths.push([0, 1, 5]);
		recordedOnFinish.push("cmt-ask-0.1.5", "cmt-say-0.1.5");
		const { pane, history } = await aPage();
		await submit(pane, "what do these have in common");
		pane.remove(); // the bar closed itself
		expect(stream.signal?.aborted, "removing the pane does not abort the stream").toBe(false);
		stream.finish?.();
		await settle();
		expect(answers(history).map((el) => [el.message.text, el.message.status, el.message.spinnerVisible])).toEqual([["an answer", "completed", false]]);
		const again = await aPane(); // the bar opened again
		await submit(again, "and what came of it");
		expect(sent.at(-1)?.sessionSeqPath).toBe("0.1.5");
		expect(onHistory(history).map((el) => el.message.text)).toEqual(["what do these have in common", "an answer", "and what came of it", ""]);
	});

	it("picked by a reader, is read back, and its last answer becomes the active record with the records its question referenced", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		const { pane, history } = await aPage();
		pickSession(pane, RESTORED);
		await answerTheSessionRead();
		expect(currentSubject(currentSubjectState.get())).toEqual({ id: `cmt-say-${RESTORED}`, label: "Comment" });
		expect(activeEntry(currentSubjectState.get())?.bundle.patterns).toEqual([RESTORED_RECORD]);
		expect(onHistory(history).map((el) => el.message.text)).toEqual([`asked ${RESTORED}`, `answered ${RESTORED}`]);
		expect(hashParam(CONVERSATION_PARAM)).toBe(RESTORED);
	});

	it("opened from the address, updates the bar's turn without taking the lead, and the next question replies to it about the record that leads", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		const { pane } = await aPage();
		const opening = openConversation(RESTORED, "update");
		await answerTheSessionRead();
		await opening;
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar)?.record).toEqual({ id: `cmt-say-${RESTORED}`, label: "Comment" });
		expect(currentSubject(currentSubjectState.get())).toEqual(EMAIL.record);
		await submit(pane, "and what came of it");
		expect(sent.at(-1)).toMatchObject({ inReplyTo: RESTORED, sessionSeqPath: RESTORED, patterns: EMAIL.bundle.patterns });
	});

	it("picked while a turn of another session runs, leaves that turn running, and the comments it records activate nothing", async () => {
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		const { pane, history } = await aPage();
		await submit(pane, "what do these have in common");
		pickSession(pane, RESTORED);
		await answerTheSessionRead();
		recordedOnFinish.push("cmt-say-0.1.2");
		stream.finish?.();
		await settle();
		expect(stream.signal?.aborted).toBe(false);
		expect(currentSubject(currentSubjectState.get()), "the session the reader picked still leads").toEqual({ id: `cmt-say-${RESTORED}`, label: "Comment" });
		expect(turnsShown(history), "and its transcript is the picked session's").toEqual([RESTORED]);
	});

	it("that fails to read back is closed, so the next question starts a session", async () => {
		const { pane } = await aPage();
		pickSession(pane, RESTORED);
		await answerTheSessionRead("the store is unreachable");
		expect(conversationState.get()).toBe(CLOSED_CONVERSATION);
		await submit(pane, "what do these have in common");
		expect(sent.at(-1)?.sessionSeqPath).toBeUndefined();
	});

	it("left for a new conversation, clears the transcript and the bar's turn, and the next question starts a session", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		const { pane, history } = await aPage();
		pickSession(pane, RESTORED);
		await answerTheSessionRead();
		pickSession(pane, NEW_CONVERSATION.value);
		await pane.updateComplete;
		expect(onHistory(history)).toHaveLength(0);
		expect(hashParam(CONVERSATION_PARAM)).toBe("");
		expect(currentSubject(currentSubjectState.get()), "the page's record leads again").toEqual(EMAIL.record);
		await submit(pane, "what does this say");
		expect(sent.at(-1)?.sessionSeqPath).toBeUndefined();
		expect(sent.at(-1)?.inReplyTo).toBeUndefined();
	});
});

describe("the transcript of a conversation that branches", () => {
	/** The first turn, a reply to it, a reply to that, and a second reply to the first turn, in the store's order. */
	const BRANCHED = [readBack("0.1.1"), readBack("0.1.3", "0.1.1"), readBack("0.1.4", "0.1.3"), readBack("0.1.5", "0.1.1")];
	const otherBranchOn = (history: HTMLElement, seqPath: string) =>
		answers(history)
			.find((el) => el.message.seqPath === seqPath)
			?.querySelector(`[data-testid="${SHU_TEST_IDS.APP.CHAT_OTHER_BRANCH}"]`) as HTMLElement | null;

	async function onTheBranchedSession(): Promise<{ pane: Driven; history: HTMLElement }> {
		sessionTurns = BRANCHED;
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		const page = await aPage();
		pickSession(page.pane, "0.1.1");
		await answerTheSessionRead();
		await page.pane.updateComplete;
		return page;
	}

	it("shows the branch the conversation is on, hides the other, and offers it where it leaves", async () => {
		const { history } = await onTheBranchedSession();
		expect(turnsShown(history)).toEqual(["0.1.1", "0.1.5"]);
		expect(onHistory(history), "every message is placed, so each keeps its place in time").toHaveLength(8);
		expect(otherBranchOn(history, "0.1.1")).not.toBeNull();
	});

	it("follows the other branch from where it leaves, and offers the branch it left", async () => {
		const { history } = await onTheBranchedSession();
		otherBranchOn(history, "0.1.1")?.click();
		expect(turnsShown(history)).toEqual(["0.1.1", "0.1.3", "0.1.4"]);
		expect(currentSubject(currentSubjectState.get())).toEqual({ id: "cmt-say-0.1.4", label: "Comment" });
		await settle();
		expect(otherBranchOn(history, "0.1.1")).not.toBeNull();
	});

	it("shows a question about an earlier answer on the branch it starts there", async () => {
		const { pane, history } = await onTheBranchedSession();
		inside<HTMLElement>(
			answers(history).find((el) => el.message.seqPath === "0.1.1"),
			".msg",
		).click();
		turnSeqPaths.push([0, 1, 9]);
		await submit(pane, "and what else");
		expect(turnsShown(history)).toEqual(["0.1.1", "0.1.9"]);
		await settle();
		expect(otherBranchOn(history, "0.1.1")?.textContent).toContain("2 other branches");
	});
});
