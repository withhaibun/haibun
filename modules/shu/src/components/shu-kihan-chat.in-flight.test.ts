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

vi.mock("../rpc-registry.js", () => ({
	getAvailableSteps: () => Promise.resolve(),
	findStep: (n: string) => n,
	requireStep: (n: string) => n,
}));
vi.mock("../rels-cache.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), getActionBarChatExtensionTags: () => [] }));
vi.mock("../chat-context-harvest.js", () => ({ harvestChatViewLd: () => [] }));
/** The session the pane remembers, and when the store answers the read of it. */
const RESTORED = "0.1.2";
let answerSessionRead: (() => void) | undefined;

vi.mock("../hypermedia.js", () => ({
	reads: (method: string, params?: Record<string, unknown>) => ({ method, params, asks: "read" }),
	acts: (method: string, params?: Record<string, unknown>) => ({ method, params, asks: "act" }),
	isOffline: () => false,
	isServerUnreachable: () => false,
	conduit: () => ({
		follow: (req: { method: string }) => {
			if (req.method === "listChatSessions") return Promise.resolve({ sessions: [{ sessionSeqPath: RESTORED, label: "an earlier conversation", generatedAtTime: "2026-05-17T05:00:00.000Z" }] });
			if (req.method === "loadChatSession")
				return new Promise((resolve) => {
					answerSessionRead = () => resolve({ turns: [{ prompt: "an earlier question", response: "an earlier answer", seqPath: RESTORED }] });
				});
			return Promise.resolve({});
		},
		// A turn whose stream stays open: the server took the question and has written nothing back yet.
		followStream: () => new Promise<void>(() => undefined),
	}),
}));

const { ShuCombobox } = await import("./shu-combobox.js");
if (!customElements.get("shu-combobox")) customElements.define("shu-combobox", ShuCombobox);
await import("./shu-chat-message.js");
const { ShuKihanChat } = await import("./shu-kihan-chat.js");

type Driven = HTMLElement & { updateComplete: Promise<unknown>; handleChat(prompt: string): Promise<void>; submitChat(): void };

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
