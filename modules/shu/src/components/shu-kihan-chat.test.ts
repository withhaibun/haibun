// @vitest-environment jsdom
/**
 * Reported: the Ask pane sometimes shows no session selector.
 *
 * The selector renders when the component holds sessions, and the session list was refreshed only when a turn's
 * stream announced its seqPath. A turn that completed without that announcement left the list empty, so the selector
 * never appeared even though the turn had been written and the session existed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const listed: Array<{ sessionSeqPath: string; label?: string; generatedAtTime?: string }> = [];
let onStartSeqPath: number[] | null = null;

vi.mock("../rpc-registry.js", () => ({
	getAvailableSteps: () => Promise.resolve(),
	findStep: (n: string) => n,
	requireStep: (n: string) => n,
}));
vi.mock("../rels-cache.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), getActionBarChatExtensionTags: () => [] }));
vi.mock("../chat-context-harvest.js", () => ({ harvestChatViewLd: () => [] }));
vi.mock("../hypermedia.js", () => ({
	isOffline: () => false,
	conduit: () => ({
		follow: (req: { method: string }) => (req.method === "listChatSessions" ? Promise.resolve({ sessions: [...listed] }) : Promise.resolve({})),
		// A turn that streams text and completes. onStart is called only when the stream announces a seqPath.
		followStream: (_req: unknown, onChunk: (c: unknown) => void, opts: { onStart?: (s: number[]) => void }) => {
			if (onStartSeqPath) opts.onStart?.(onStartSeqPath);
			onChunk({ text: "an answer" });
			// The turn is written server-side either way, so the session now exists.
			listed.push({ sessionSeqPath: "0.1.2", label: "a session", generatedAtTime: new Date().toISOString() });
			return Promise.resolve();
		},
	}),
}));

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

describe("the session selector after a turn", () => {
	beforeEach(() => {
		listed.length = 0;
		onStartSeqPath = [0, 1, 2];
	});

	it("appears when the turn's stream announced its seqPath", async () => {
		const el = await chat();
		await turn(el);
		expect(hasSelector(el)).toBe(true);
	});

	it("appears when the stream did not announce one, since the session exists either way", async () => {
		onStartSeqPath = null;
		const el = await chat();
		await turn(el);
		expect(hasSelector(el)).toBe(true);
	});
});
