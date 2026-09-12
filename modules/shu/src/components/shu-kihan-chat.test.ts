// @vitest-environment jsdom
/**
 * Reported: the Ask pane sometimes shows no session selector.
 *
 * The selector used to render only when the pane held sessions, and the list was refreshed only when a turn's stream
 * announced its seqPath, so a turn that announced none left it missing. A control that appears and disappears is the
 * fault: the selector is always rendered, and its options fill in as sessions arrive.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const listed: Array<{ sessionSeqPath: string; label?: string; generatedAtTime?: string }> = [];
let onStartSeqPath: number[] | null = null;
/** What the server answers the session read with. A deployment that answers without the list is the failed-read case. */
let sessionsAnswer: () => Record<string, unknown> = () => ({ sessions: [...listed] });

// Partial: the registry's own reads are answered here, and everything else it exports stays itself, so a module that
// reaches for one of them is not left with a rejected import.
vi.mock("../rpc-registry.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), ...(await import("./chat-pane.test-fake.js")).rpcRegistry }));
vi.mock("../rels-cache.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), getActionBarChatExtensionTags: () => [] }));
vi.mock("../chat-context-harvest.js", () => ({ harvestChatViewLd: () => [] }));
vi.mock("../hypermedia.js", async () => {
	const { hypermedia } = await import("./chat-pane.test-fake.js");
	return hypermedia(
		(req) => (req.method === "listChatSessions" ? sessionsAnswer() : {}),
		// A turn that streams text and completes. onStart is called only when the stream announces a seqPath.
		(_req, onChunk, opts) => {
			if (onStartSeqPath) opts.onStart?.(onStartSeqPath);
			onChunk({ text: "an answer" });
			// The turn is written server-side either way, so the session now exists.
			listed.push({ sessionSeqPath: "0.1.2", label: "a session", generatedAtTime: new Date().toISOString() });
			return Promise.resolve();
		},
	);
});

// The selector must be a real combobox, so define that one element rather than the whole registry.
const { ShuCombobox } = await import("./shu-combobox.js");
if (!customElements.get("shu-combobox")) customElements.define("shu-combobox", ShuCombobox);
const { ShuKihanChat } = await import("./shu-kihan-chat.js");

async function chat(): Promise<HTMLElement & { submitPrompt?: unknown }> {
	document.body.innerHTML = "";
	const el = new ShuKihanChat();
	document.body.appendChild(el);
	await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
	return el as unknown as HTMLElement;
}

const hasSelector = (el: HTMLElement) => !!el.shadowRoot?.querySelector(".session-select");

/** Drive one turn the way the submit handler does, without depending on the button's markup. */
async function turn(el: HTMLElement): Promise<void> {
	await (el as unknown as { handleChat: (p: string) => Promise<void> }).handleChat("ask something");
	// The session refresh is fire-and-forget, so let its promise and the render that follows settle.
	await new Promise((resolve) => setTimeout(resolve, 0));
	await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

const messageCount = (el: HTMLElement) => el.shadowRoot?.querySelectorAll("shu-chat-message").length ?? 0;

const optionCount = (el: HTMLElement) => (el.shadowRoot?.querySelector(".session-select") as unknown as { options?: unknown[] })?.options?.length ?? 0;

describe("the session selector", () => {
	beforeEach(() => {
		listed.length = 0;
		onStartSeqPath = [0, 1, 2];
		sessionsAnswer = () => ({ sessions: [...listed] });
	});

	it("is there before any turn, with no sessions to offer", async () => {
		const el = await chat();
		expect(hasSelector(el)).toBe(true);
	});

	it("is still there after a turn, now offering the session that turn created", async () => {
		const el = await chat();
		await turn(el);
		expect(hasSelector(el)).toBe(true);
		expect(optionCount(el)).toBe(1);
	});

	it("keeps the pane rendering when the read answers with no list, so the conversation continues past that turn", async () => {
		sessionsAnswer = () => ({});
		const el = await chat();
		await turn(el);
		expect(hasSelector(el)).toBe(true);
		await turn(el);
		expect(messageCount(el)).toBe(4);
	});

	it("offers the session even when the turn's stream announced no seqPath, since the session exists either way", async () => {
		onStartSeqPath = null;
		const el = await chat();
		await turn(el);
		expect(hasSelector(el)).toBe(true);
		expect(optionCount(el)).toBe(1);
	});
});
