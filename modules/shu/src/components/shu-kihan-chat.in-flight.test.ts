// @vitest-environment jsdom
/**
 * The Ask pane with a turn in flight, rendered in jsdom against a stream a case holds open and finishes.
 *
 * One turn runs at a time. A question submitted while a turn runs is refused, and the running reply shows the refusal.
 * The pane restores its last session when it mounts, and that read resolves when the store responds. A question asked
 * before the read resolves replaces the conversation, and the pane discards the restored turns. A turn outlasts the pane
 * that started it, and the next pane renders the turn's remaining changes or its ended state.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { TChatMessage } from "./shu-chat-message.js";
import { anIndividual } from "../schemas.js";
import type { TDriven as Driven } from "./chat-pane.test-fake.js";

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
const sent: Array<{ contextReadBy?: string; patterns?: unknown[]; inReplyTo?: string; viewLd?: unknown[] }> = [];
/** The comments the turn records, named on the stream as the server names them. */
const recorded: string[] = [];
/** The running stream's abort signal and its finish function. One object holds both, so a case reads the values the
 *  mock sets after the case's own resets. */
const stream: { signal: AbortSignal | undefined; finish: (() => void) | undefined } = { signal: undefined, finish: undefined };
/** Clear the last stream. A function call keeps the type checker from narrowing the fields the mock sets later. */
function resetStream(): void {
	stream.signal = undefined;
	stream.finish = undefined;
}

/** The session the pane remembers, its one turn as the store reads it back, and when the store answers the read. */
const RESTORED = "0.1.1";
const RESTORED_RECORD = anIndividual("Email", "restored@bakery.test");
const RESTORED_TURN = { prompt: "an earlier question", response: "an earlier answer", seqPath: RESTORED, askId: `cmt-ask-${RESTORED}`, sayId: `cmt-say-${RESTORED}`, bundle: [RESTORED_RECORD] };
let answerSessionRead: (() => void) | undefined;
/** The comments the stream names when a case finishes it, after the turn has run for a while. */
const recordedOnFinish: string[] = [];

vi.mock("../hypermedia.js", async () => {
	const { hypermedia } = await import("./chat-pane.test-fake.js");
	return hypermedia(
		(req) => {
			// The registry as the server holds it: a model states who reads its context, which the pane shows on the default.
			if (req.method === "showKihans") return { vertices: [{ id: "openai:a-model", displayName: "a model", capabilities: { tools: true } }] };
			if (req.method === "listChatSessions") return { sessions: [{ sessionSeqPath: RESTORED, label: "an earlier conversation", generatedAtTime: "2026-05-17T05:00:00.000Z" }] };
			// A read held open, answered when a case says the store got back to the pane.
			if (req.method === "loadChatSession")
				return new Promise((resolve) => {
					answerSessionRead = () => resolve({ turns: [RESTORED_TURN] });
				});
			return {};
		},
		// A turn whose stream stays open: the server took the question and has written nothing back yet. Each status it
		// states first is what the turn says about itself.
		(req, onChunk, opts) => {
			opts.onStart?.([0, 1, 2]);
			sent.push(JSON.parse(String(req.params?.context ?? "{}")));
			for (const id of recorded) onChunk({ recorded: { persistedAs: "Comment", id } });
			for (const status of stated) onChunk({ status });
			if (streamFails) return Promise.reject(new Error(streamFails));
			// An aborted stream rejects, as the fetch that carries it does. A case finishes the stream with the reply text.
			stream.signal = opts.signal;
			return new Promise<void>((resolve, reject) => {
				opts.signal?.addEventListener("abort", () => reject(new Error("the stream was aborted")), { once: true });
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
await import("./shu-chat-message.js");
const { ShuActivityHistory } = await import("./shu-activity-history.js");
if (!customElements.get("shu-activity-history")) customElements.define("shu-activity-history", ShuActivityHistory);
const { ShuKihanChat, TURN_STILL_RUNNING } = await import("./shu-kihan-chat.js");
const { currentTurn, stopTurn } = await import("../chat-turn.js");
const { flushPersistWrites } = await import("../element-prefs.js");
const { INITIAL_SUBJECT, SCOPE, activeEntry, currentSubject, currentSubjectState, dispatchSubjectEvent, entryOf, scopeEntry } = await import("../current-subject.js");

// The turn runner and the machine are module state shared by every case. Each case starts with no running turn and
// no current subject, because a turn left running refuses the next case's question.
beforeEach(async () => {
	stopTurn("the case ended");
	await new Promise((resolve) => setTimeout(resolve, 0));
	currentSubjectState.set(INITIAL_SUBJECT);
	stated.length = 0;
	sent.length = 0;
	recorded.length = 0;
	recordedOnFinish.length = 0;
	streamFails = undefined;
	answerSessionRead = undefined;
});


/** The pane with a turn running: the first question sent, its stream still open. */
async function paneHoldingATurn(): Promise<Driven> {
	document.body.innerHTML = "";
	const el = new ShuKihanChat() as unknown as Driven;
	document.body.appendChild(el);
	await el.updateComplete;
	void el.handleChat("what do these have in common");
	await new Promise((resolve) => setTimeout(resolve, 0));
	await el.updateComplete;
	return el;
}

const chatInput = (el: Driven) => el.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement;
const messages = (el: Driven) => Array.from(el.shadowRoot?.querySelectorAll("shu-chat-message") ?? []).map((m) => (m as unknown as { message: TChatMessage }).message);
/** The control that says who reads this conversation's context. */
const reading = (el: Driven) => el.shadowRoot?.querySelector(".context-read") as HTMLSelectElement;

const hidden = (el: Driven, selector: string) => (el.shadowRoot?.querySelector(selector) as HTMLElement | null)?.style.display === "none";

describe("a question asked while the pane is restoring the session it left off in", () => {
	it("holds the question, and the restore that lands after it is abandoned rather than rendered over it", async () => {
		document.body.innerHTML = "";
		const el = new ShuKihanChat() as unknown as Driven & { setState(s: Record<string, unknown>): void };
		el.setState({ session: RESTORED });
		document.body.appendChild(el);
		await el.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 0));

		void el.handleChat("what do these have in common");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await el.updateComplete;
		expect(messages(el).map((m) => m.text)).toContain("what do these have in common");

		answerSessionRead?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await el.updateComplete;
		expect(messages(el).map((m) => m.text), "the turn the reader asked for is still the conversation").toContain("what do these have in common");
		expect(messages(el).map((m) => m.text), "and the persisted exchanges did not take its place").not.toContain("an earlier question");
	});
});

describe("a turn that ends before it answered", () => {
	it("says what went wrong, whatever ended it, and stops the spinner", async () => {
		stated.length = 0;
		streamFails = "the model did not answer: connection reset";
		const el = await paneHoldingATurn();
		await el.updateComplete;

		const turn = messages(el).find((m) => m.role === "llm");
		expect(turn?.error, "what went wrong is on the turn").toContain("connection reset");
		expect(turn?.status).toBe("failed");
		expect(turn?.spinnerVisible, "and nothing is left spinning").toBe(false);
		streamFails = undefined;
	});

	it("names a reader's own stop as theirs, and still says what came back with it", async () => {
		stated.length = 0;
		const el = await paneHoldingATurn();
		(el as unknown as { onStop(): void }).onStop();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await el.updateComplete;

		const turn = messages(el).find((m) => m.role === "llm");
		expect(turn?.error, "the reader's own stop is named as theirs").toContain("you stopped it");
		expect(turn?.error, "with what ended the stream beside it").toContain("aborted");
		expect(turn?.status).toBe("aborted");
	});
});

describe("who reads the context, stated where the conversation is", () => {
	it("stands at the model's default until a reader says otherwise, and the turn carries nothing about it", async () => {
		stated.length = 0;
		const el = await paneHoldingATurn();
		expect(reading(el).value, "the default, which is what the model states").toBe("");
		expect(reading(el).options[0].text, "and the control says so").toContain("model default");
		expect(sent.at(-1)?.contextReadBy).toBeUndefined();
	});

	it("names what the model states, so leaving it alone is not leaving it unsaid", async () => {
		stated.length = 0;
		const el = await paneHoldingATurn();
		await el.updateComplete;
		expect(reading(el).options[0].text, "the default says what the chosen model sends").toBe("model default (sends tool cues)");
	});

	it("carries what a reader states, so the next turn is read the way they asked", async () => {
		stated.length = 0;
		document.body.innerHTML = "";
		const el = new ShuKihanChat() as unknown as Driven;
		document.body.appendChild(el);
		await el.updateComplete;
		const control = reading(el);
		control.value = "model";
		control.dispatchEvent(new Event("change"));
		await el.updateComplete;

		void el.handleChat("and now with the model reading it");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sent.at(-1)?.contextReadBy).toBe("model");
		expect(reading(el).value, "and the control holds what they said").toBe("model");
	});
});

describe("what a turn states about itself", () => {
	it("keeps every statement on the turn, so the context sent and the calls made are there to read", async () => {
		stated.length = 0;
		stated.push("context sent:\nEmail -> total -> 2", "dispatching GraphStepper-graphQuery, reading the emails", "generated 40 chars");
		const el = await paneHoldingATurn();

		const running = messages(el).find((m) => m.role === "llm");
		expect(running?.activity, "each statement, in the order the turn made them").toEqual(stated);
		expect(running?.spinnerStatus, "and the latest of them is what the spinner shows").toBe("generated 40 chars");
		stated.length = 0;
	});
});

describe("a question asked while a turn is running", () => {
	it("shows the refusal on the running reply, and keeps the question", async () => {
		const el = await paneHoldingATurn();
		chatInput(el).value = "which one mentions the crumb";
		el.submitChat();
		await el.updateComplete;

		const running = messages(el).find((m) => m.role === "llm");
		expect(running?.spinnerStatus).toBe(TURN_STILL_RUNNING);
		expect(chatInput(el).value).toBe("which one mentions the crumb");
		expect(messages(el).filter((m) => m.role === "user")).toHaveLength(1);
	});

	it("offers Stop, and not Send, as the control that ends the turn holding the pane", async () => {
		const el = await paneHoldingATurn();
		expect(hidden(el, ".send-btn")).toBe(true);
		expect(hidden(el, ".stop-btn")).toBe(false);
	});
});

describe("the ask and the active record", () => {
	const EMAIL = entryOf([anIndividual("Email", "read-me@bakery.test")], "private");
	const OTHER = entryOf([anIndividual("Email", "other@bakery.test")], "private");
	const paneAsking = async (prompt: string): Promise<Driven> => {
		document.body.innerHTML = "";
		const el = new ShuKihanChat() as unknown as Driven;
		document.body.appendChild(el);
		await el.updateComplete;
		void el.handleChat(prompt);
		await new Promise((resolve) => setTimeout(resolve, 0));
		return el;
	};

	it("sends the bundle of the record the page activated, with the pane's view data, and replies to nothing yet", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		await paneAsking("what does this say");
		expect(sent.at(-1)?.patterns, "the record's bundle").toEqual(EMAIL.bundle.patterns);
		expect(sent.at(-1)?.viewLd, "and the view data of the pane that shows it").toEqual(VIEW_DATA);
		expect(sent.at(-1)?.inReplyTo, "a first question replies to nothing").toBeUndefined();
	});

	it("activates each comment the turn records with the bundle it was sent with, and it leads while the bar is open", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		recorded.push("cmt-ask-0.1.2");
		await paneAsking("what does this say");
		const state = currentSubjectState.get();
		expect(currentSubject(state), "the question's own record").toEqual({ id: "cmt-ask-0.1.2", label: "Comment" });
		expect(state.scopes[SCOPE.actionsBar].entry, "with its turn and the bundle it was sent with").toEqual({
			record: { id: "cmt-ask-0.1.2", label: "Comment" },
			seqPath: "0.1.2",
			bundle: EMAIL.bundle,
		});
		dispatchSubjectEvent({ type: "close", scope: SCOPE.actionsBar });
		expect(currentSubject(currentSubjectState.get()), "the bar closed: the page's record again").toEqual(EMAIL.record);
	});

	it("replies to the conversation's entry and carries its bundle, so a selected earlier message branches there", async () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: { record: { id: "cmt-say-0.1.1", label: "Comment" }, seqPath: "0.1.1", bundle: OTHER.bundle } });
		await paneAsking("and what came of it");
		expect(sent.at(-1)?.inReplyTo, "the turn of the message selected").toBe("0.1.1");
		expect(sent.at(-1)?.patterns, "the bundle that message's turn was sent with").toEqual(OTHER.bundle.patterns);
		expect(sent.at(-1)?.viewLd, "and no view data, which is the pane's").toEqual([]);
	});
});

describe("a session the pane reads back", () => {
	const EMAIL = entryOf([anIndividual("Email", "read-me@bakery.test")], "private");
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	const pickSession = (el: Driven) => (el as unknown as { onSessionChange(e: CustomEvent): void }).onSessionChange(new CustomEvent("combo-change", { detail: { value: RESTORED } }));
	/** Answer the session read this case's pane is waiting on, once the pane has made it. */
	const answerTheSessionRead = async () => {
		await settle();
		if (!answerSessionRead) throw new Error("the pane made no session read to answer");
		answerSessionRead();
		await settle();
	};

	it("restored on mount, updates the conversation with its last answer without taking the lead, and the next question replies to it", async () => {
		document.body.innerHTML = "";
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		const el = new ShuKihanChat() as unknown as Driven;
		el.setState({ session: RESTORED });
		document.body.appendChild(el);
		await el.updateComplete;
		await answerTheSessionRead();
		expect(scopeEntry(currentSubjectState.get(), SCOPE.actionsBar), "the restored last answer, with the records its question referenced").toMatchObject({
			record: { id: RESTORED_TURN.sayId, label: "Comment" },
			seqPath: RESTORED,
			bundle: { patterns: [RESTORED_RECORD] },
		});
		expect(currentSubject(currentSubjectState.get()), "a restore is not a reader's act, so the page's record still leads").toEqual(EMAIL.record);

		void el.handleChat("and what came of it");
		await settle();
		expect(sent.at(-1), "the question replies to the restored answer, in its session, about the record that leads").toMatchObject({
			inReplyTo: RESTORED,
			sessionSeqPath: RESTORED,
			patterns: EMAIL.bundle.patterns,
		});
	});

	it("picked by a reader, makes its last answer the active record with the records its question referenced", async () => {
		document.body.innerHTML = "";
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: EMAIL });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		const el = new ShuKihanChat() as unknown as Driven;
		document.body.appendChild(el);
		await el.updateComplete;
		pickSession(el);
		await answerTheSessionRead();
		const state = currentSubjectState.get();
		expect(currentSubject(state)).toEqual({ id: RESTORED_TURN.sayId, label: "Comment" });
		expect(activeEntry(state)?.bundle.patterns).toEqual([RESTORED_RECORD]);
	});

	it("picked while a turn runs, leaves that turn running, and the comments it records then activate nothing", async () => {
		document.body.innerHTML = "";
		resetStream();
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		const el = await paneHoldingATurn();
		pickSession(el);
		await answerTheSessionRead();
		recordedOnFinish.push("cmt-say-0.1.2");
		stream.finish?.();
		await settle();
		expect(stream.signal?.aborted, "the turn ran to its end").toBe(false);
		expect(currentSubject(currentSubjectState.get()), "the session the reader picked is still what leads").toEqual({ id: RESTORED_TURN.sayId, label: "Comment" });
	});
});

describe("a turn outlasts the pane that started it", () => {
	// The actions bar removes the pane when it closes, and a click elsewhere on the page closes the bar.
	it("keeps running when the pane is removed, and the next pane renders the rest of it", async () => {
		document.body.innerHTML = "<shu-activity-history></shu-activity-history>";
		resetStream();
		const surface = document.querySelector("shu-activity-history") as HTMLElement;
		const first = new ShuKihanChat() as unknown as Driven & { outputTarget: unknown };
		document.body.appendChild(first);
		first.outputTarget = surface;
		await first.updateComplete;
		void first.handleChat("what do these have in common");
		await new Promise((resolve) => setTimeout(resolve, 0));
		first.remove(); // the bar closed itself
		expect(stream.signal?.aborted, "removing the pane does not abort the stream").toBe(false);
		expect(currentTurn()?.status, "the turn still runs").toBe("running");

		const again = new ShuKihanChat() as unknown as Driven & { outputTarget: unknown };
		document.body.appendChild(again);
		again.outputTarget = surface; // the bar opened again, over the same surface
		await again.updateComplete;
		stream.finish?.();
		await new Promise((resolve) => setTimeout(resolve, 50));
		await again.updateComplete;
		const onSurface = Array.from(surface.querySelectorAll(":scope > shu-chat-message")).map((m) => (m as unknown as { message: TChatMessage }).message);
		const reply = onSurface.find((m) => m.role === "llm");
		expect(reply?.text, "the next pane renders the reply").toBe("an answer");
		expect(reply?.status).toBe("completed");
	});

	it("ends while no pane is mounted, and the next pane renders the reply as completed", async () => {
		document.body.innerHTML = "<shu-activity-history></shu-activity-history>";
		resetStream();
		const surface = document.querySelector("shu-activity-history") as HTMLElement;
		const first = new ShuKihanChat() as unknown as Driven & { outputTarget: unknown };
		document.body.appendChild(first);
		first.outputTarget = surface;
		await first.updateComplete;
		void first.handleChat("what do these have in common");
		await new Promise((resolve) => setTimeout(resolve, 0));
		first.remove(); // the bar closed itself
		stream.finish?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(currentTurn()?.status, "the turn ended with no pane mounted").toBe("completed");

		const again = new ShuKihanChat() as unknown as Driven & { outputTarget: unknown };
		document.body.appendChild(again);
		again.outputTarget = surface; // the bar opened again, over the same surface
		await again.updateComplete;
		const reply = Array.from(surface.querySelectorAll(":scope > shu-chat-message"))
			.map((m) => (m as unknown as { message: TChatMessage }).message)
			.find((m) => m.role === "llm");
		expect(reply?.status, "the reply is completed, not left running").toBe("completed");
		expect(reply?.text).toBe("an answer");
		expect(reply?.spinnerVisible, "and the spinner is hidden").toBe(false);
	});

	it("continues the session in the pane built next, which the bar hands the surface before it is connected", async () => {
		// The bar's template sets the output target on a pane before inserting it, so the pane takes over the conversation
		// before its remembered session is restored; the next question still belongs to that session.
		document.body.innerHTML = "<shu-activity-history></shu-activity-history>";
		resetStream();
		const surface = document.querySelector("shu-activity-history") as HTMLElement;
		const first = new ShuKihanChat() as unknown as Driven & { outputTarget: unknown };
		document.body.appendChild(first);
		first.outputTarget = surface;
		await first.updateComplete;
		void first.handleChat("what do these have in common");
		await new Promise((resolve) => setTimeout(resolve, 0));
		stream.finish?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushPersistWrites();
		first.remove(); // the bar closed

		const again = new ShuKihanChat() as unknown as Driven & { outputTarget: unknown };
		again.outputTarget = surface; // the bar opened again: the surface first, then the pane inserted
		document.body.appendChild(again);
		await again.updateComplete;
		void again.handleChat("and what came of it");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((sent.at(-1) as { sessionSeqPath?: string }).sessionSeqPath, "the question belongs to the session the first turn started").toBe("0.1.2");
	});

	it("ends only when the reader stops it, with the reader's reason", async () => {
		const el = await paneHoldingATurn();
		const stop = el.shadowRoot?.querySelector(".stop-btn") as HTMLButtonElement | null;
		stop?.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await el.updateComplete;
		expect(stream.signal?.aborted).toBe(true);
		expect(messages(el).find((m) => m.role === "llm")?.error).toContain("you stopped it");
		expect(currentTurn()?.status).toBe("aborted");
	});
});

describe("a message is a record the reader can select", () => {
	it("selecting a message makes its recorded comment the active record, and marks the message current", async () => {
		document.body.innerHTML = "<shu-activity-history></shu-activity-history>";
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: entryOf([anIndividual("Email", "read-me@bakery.test")], "private") });
		dispatchSubjectEvent({ type: "open", scope: SCOPE.actionsBar });
		recorded.push("cmt-ask-0.1.2", "cmt-say-0.1.2");
		const surface = document.querySelector("shu-activity-history") as HTMLElement;
		const el = new ShuKihanChat() as unknown as Driven & { outputTarget: unknown };
		document.body.appendChild(el);
		el.outputTarget = surface;
		await el.updateComplete;
		void el.handleChat("what does this say");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await el.updateComplete;
		const question = surface.querySelector(":scope > shu-chat-message[data-record='cmt-ask-0.1.2']") as HTMLElement;
		expect(question, "the question carries the id of its recorded comment").not.toBeNull();
		(question.querySelector(".msg") as HTMLElement).click();
		await el.updateComplete;
		expect(currentSubject(currentSubjectState.get())).toEqual({ id: "cmt-ask-0.1.2", label: "Comment" });
		expect(question.getAttribute("aria-current"), "and the question is marked current").toBe("");
		expect(surface.querySelectorAll("[aria-current]").length, "and no other message is").toBe(1);
	});
});
