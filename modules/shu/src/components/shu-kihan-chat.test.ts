// @vitest-environment jsdom
/**
 * Reported: the Ask pane sometimes shows no session selector.
 *
 * The selector used to render only when the pane held sessions, and the list was refreshed only when a turn's stream
 * announced its seqPath, so a turn that announced none left it missing. A control that appears and disappears is the
 * fault: the selector is always rendered, and its options fill in as sessions arrive.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const listed: Array<{ session: string; label: string; generatedAtTime: string; turns: number }> = [];
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
		(req) => (req.method === "listChatSessions" ? sessionsAnswer() : req.method === "showKihans" ? { vertices: [], total: 0 } : {}),
		// A turn that streams text and completes. onStart is called only when the stream announces a seqPath.
		(_req, onChunk, opts) => {
			if (onStartSeqPath) opts.onStart?.(onStartSeqPath);
			onChunk({ text: "an answer" });
			// The turn is written server-side either way, so the session now exists.
			listed.push({ session: "cmt-ask-0.1.2", label: "a session", generatedAtTime: new Date().toISOString(), turns: 1 });
			return Promise.resolve();
		},
	);
});

// The selector must be a real combobox, so define that one element rather than the whole registry.
const { ShuCombobox } = await import("./shu-combobox.js");
if (!customElements.get("shu-combobox")) customElements.define("shu-combobox", ShuCombobox);
const { ShuKihanChat } = await import("./shu-kihan-chat.js");
const { SHU_ATTR } = await import("../consts.js");
const { CLOSED_CONVERSATION, conversationState } = await import("../conversation.js");

async function chat(): Promise<HTMLElement> {
	document.body.innerHTML = "";
	const el = new ShuKihanChat();
	// The selector is one of the chat's settings, which the pane's settings control shows.
	el.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
	document.body.appendChild(el);
	await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
	return el as unknown as HTMLElement;
}

const hasSelector = (el: HTMLElement) => !!el.shadowRoot?.querySelector(".session-select");

/** Type the question and submit it, as a reader does, and let the turn end. */
async function turn(el: HTMLElement, prompt = "ask something"): Promise<void> {
	(el.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement).value = prompt;
	await (el as unknown as { submitChat: () => Promise<void> }).submitChat();
	// The session refresh is fire-and-forget, so let its promise and the render that follows settle.
	await new Promise((resolve) => setTimeout(resolve, 0));
	await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

const optionCount = (el: HTMLElement) => (el.shadowRoot?.querySelector(".session-select") as unknown as { options?: unknown[] })?.options?.length ?? 0;

describe("the session selector", () => {
	beforeEach(() => {
		conversationState.set(CLOSED_CONVERSATION);
		listed.length = 0;
		onStartSeqPath = [0, 1, 2];
		sessionsAnswer = () => ({ sessions: [...listed] });
	});

	it("is there before any turn, offering a new conversation and no sessions", async () => {
		const el = await chat();
		expect(hasSelector(el)).toBe(true);
		expect(optionCount(el)).toBe(1);
	});

	it("is still there after a turn, now offering the session that turn created after a new conversation", async () => {
		const el = await chat();
		await turn(el);
		expect(hasSelector(el)).toBe(true);
		expect(optionCount(el)).toBe(2);
	});

	it("keeps the pane rendering when the read answers with no list, so the conversation continues past that turn", async () => {
		sessionsAnswer = () => ({});
		const el = await chat();
		await turn(el, "the first");
		expect(hasSelector(el)).toBe(true);
		await turn(el, "the second");
		expect(conversationState.get().asked).toMatchObject({ prompt: "the second", status: "completed" });
	});

	it("offers the session even when the turn's stream announced no seqPath, since the session exists either way", async () => {
		onStartSeqPath = null;
		const el = await chat();
		await turn(el);
		expect(hasSelector(el)).toBe(true);
		expect(optionCount(el)).toBe(2);
	});
});

/**
 * The chat's settings are the view's settings: the session, the model, the tool limit and what a turn sends. The pane's
 * settings control shows them, as it shows every view's, and they stand above the transcript the ask holds.
 */
describe("the chat's settings", () => {
	beforeEach(() => {
		conversationState.set(CLOSED_CONVERSATION);
		listed.length = 0;
		onStartSeqPath = [0, 1, 2];
		sessionsAnswer = () => ({ sessions: [...listed] });
	});

	/** The chat as a pane holds it with its settings hidden, which is how a reader first sees it. */
	async function withoutSettings(): Promise<HTMLElement> {
		const el = await chat();
		el.removeAttribute("data-show-controls");
		await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		return el;
	}

	it("holds the question and its Send without them, so a reader asks without stating any of them", async () => {
		const el = await withoutSettings();
		expect(el.shadowRoot?.querySelector(".chat-settings"), "the settings are not shown").toBeNull();
		expect(el.shadowRoot?.querySelector(".chat-input"), "the question is").not.toBeNull();
		expect(el.shadowRoot?.querySelector(".send-btn")).not.toBeNull();
	});

	it("shows them when the pane's settings control does, and hides them when it does again", async () => {
		const el = await withoutSettings();
		el.setAttribute("data-show-controls", "");
		await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		const settings = el.shadowRoot?.querySelector(".chat-settings");
		expect(settings?.querySelector(".session-select"), "the session").not.toBeNull();
		expect(settings?.querySelector(".tool-limit"), "the tool limit").not.toBeNull();
		expect(settings?.querySelector(".context-read"), "and what a turn sends").not.toBeNull();
		el.removeAttribute("data-show-controls");
		await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
		expect(el.shadowRoot?.querySelector(".chat-settings")).toBeNull();
	});

	it("stands above the transcript, and the transcript stands above the input line", async () => {
		const el = await chat();
		// jsdom holds the styles as elements in the root; the regions are what the chat renders.
		const parts = Array.from(el.shadowRoot?.children ?? [])
			.map((c) => c.className)
			.filter(Boolean);
		expect(parts).toEqual(["chat-settings", "transcript", "input-line"]);
		expect(el.shadowRoot?.querySelector(".transcript slot"), "the transcript takes what the bar puts in it").not.toBeNull();
	});
});
