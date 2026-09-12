// @vitest-environment jsdom
/**
 * Reported: the Ask pane stops taking messages after a few have been sent, and a question entered into it is followed
 * by the previous few exchanges rendering in its place.
 *
 * Two things a turn has to survive. A turn runs one at a time, so a question typed while one is still running is not
 * sent: refusing it silently is what reads as a pane that has stopped working. And the pane restores the session the
 * visit left off in when it mounts, a read that takes as long as the store takes: a question asked while that read is
 * in flight is the conversation now, and the restore is abandoned rather than rendered over it.
 */
import { describe, it, expect, vi } from "vitest";
import type { TChatMessage } from "./shu-chat-message.js";
import type { TDriven as Driven } from "./chat-pane.test-fake.js";

// Partial: the registry's own reads are answered here, and everything else it exports stays itself, so a module that
// reaches for one of them is not left with a rejected import.
vi.mock("../rpc-registry.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), ...(await import("./chat-pane.test-fake.js")).rpcRegistry }));
vi.mock("../rels-cache.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), getActionBarChatExtensionTags: () => [] }));
vi.mock("../chat-context-harvest.js", () => ({ harvestChatViewLd: () => [] }));
/** What the turn states about itself before it writes anything. */
const stated: string[] = [];
/** What the stream fails with, where it does; unset leaves it open. */
let streamFails: string | undefined;
/** The context envelope each turn was sent with, so a case reads what the pane asked for. */
const sent: Array<{ contextReadBy?: string }> = [];

/** The session the pane remembers, and when the store answers the read of it. */
const RESTORED = "0.1.2";
let answerSessionRead: (() => void) | undefined;

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
					answerSessionRead = () => resolve({ turns: [{ prompt: "an earlier question", response: "an earlier answer", seqPath: RESTORED }] });
				});
			return {};
		},
		// A turn whose stream stays open: the server took the question and has written nothing back yet. Each status it
		// states first is what the turn says about itself.
		(req, onChunk, opts) => {
			sent.push(JSON.parse(String(req.params?.context ?? "{}")));
			for (const status of stated) onChunk({ status });
			if (streamFails) return Promise.reject(new Error(streamFails));
			// A stream the caller aborts ends as one: the fetch it rides rejects, which is what the pane reads.
			return new Promise<void>((_resolve, reject) => opts.signal?.addEventListener("abort", () => reject(new Error("the stream was aborted")), { once: true }));
		},
	);
});

const { ShuCombobox } = await import("./shu-combobox.js");
if (!customElements.get("shu-combobox")) customElements.define("shu-combobox", ShuCombobox);
await import("./shu-chat-message.js");
const { ShuKihanChat } = await import("./shu-kihan-chat.js");


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
	it("states on the running turn that the pane is still answering, and keeps the question", async () => {
		const el = await paneHoldingATurn();
		chatInput(el).value = "which one mentions the crumb";
		el.submitChat();
		await el.updateComplete;

		const running = messages(el).find((m) => m.role === "llm");
		expect(running?.spinnerStatus).toBe("still answering the last question; Stop to ask another");
		expect(chatInput(el).value).toBe("which one mentions the crumb");
		expect(messages(el).filter((m) => m.role === "user")).toHaveLength(1);
	});

	it("offers Stop, and not Send, as the control that ends the turn holding the pane", async () => {
		const el = await paneHoldingATurn();
		expect(hidden(el, ".send-btn")).toBe(true);
		expect(hidden(el, ".stop-btn")).toBe(false);
	});
});
