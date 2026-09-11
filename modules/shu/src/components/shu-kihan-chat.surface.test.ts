// @vitest-environment jsdom
/**
 * Reported: closing the actions bar wipes the conversation.
 *
 * The conversation has to be there whenever the pane is built, and the pane is built often: the bar drops it when it is
 * closed and builds another when it is opened, while the transcript stays on the bar's own activity history. On the
 * same page it is taken over from that surface, which needs no read at all. On a new page there is nothing to take
 * over, and it is read back from the comments each turn was written as, by itself: read behind a listing of every other
 * session, the pane held nothing for as long as that listing took and nothing at all when it did not answer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TChatMessage } from "./shu-chat-message.js";

vi.mock("../rpc-registry.js", () => ({
	getAvailableSteps: () => Promise.resolve(),
	findStep: (n: string) => n,
	requireStep: (n: string) => n,
}));
vi.mock("../rels-cache.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), getActionBarChatExtensionTags: () => [] }));
vi.mock("../chat-context-harvest.js", () => ({ harvestChatViewLd: () => [] }));

const SESSION = "0.1.2";
/** What the store answers each read with. A read set to never answer is a store that has not got back to the page. */
let sessionsAnswer: { sessions: unknown[] } | null = { sessions: [{ sessionSeqPath: SESSION, label: "the conversation", generatedAtTime: "2026-05-17T05:00:00.000Z" }] };
let turnsAnswer: { turns: Array<{ prompt: string; response: string; seqPath: string }> } | null = null;

vi.mock("../hypermedia.js", () => ({
	reads: (method: string, params?: Record<string, unknown>) => ({ method, params, asks: "read" }),
	acts: (method: string, params?: Record<string, unknown>) => ({ method, params, asks: "act" }),
	isOffline: () => false,
	isServerUnreachable: () => false,
	conduit: () => ({
		follow: (req: { method: string }) => {
			if (req.method === "listChatSessions") return sessionsAnswer ? Promise.resolve(sessionsAnswer) : new Promise(() => undefined);
			if (req.method === "loadChatSession") return turnsAnswer ? Promise.resolve(turnsAnswer) : new Promise(() => undefined);
			return Promise.resolve({});
		},
		followStream: (_req: unknown, onChunk: (c: unknown) => void, opts: { onStart?: (s: number[]) => void }) => {
			opts.onStart?.([0, 1, 2]);
			onChunk({ text: "an answer" });
			return Promise.resolve();
		},
	}),
}));

const { ShuCombobox } = await import("./shu-combobox.js");
if (!customElements.get("shu-combobox")) customElements.define("shu-combobox", ShuCombobox);
await import("./shu-chat-message.js");
const { ShuActivityHistory } = await import("./shu-activity-history.js");
if (!customElements.get("shu-activity-history")) customElements.define("shu-activity-history", ShuActivityHistory);
const { ShuKihanChat } = await import("./shu-kihan-chat.js");

type Driven = HTMLElement & { updateComplete: Promise<unknown>; handleChat(prompt: string): Promise<void>; outputTarget: unknown; setState(s: Record<string, unknown>): void };

/** The bar's activity history: one surface the pane is built over and dropped from. */
const surface = () => document.querySelector("shu-activity-history") as HTMLElement;
const onSurface = () => Array.from(surface().querySelectorAll(":scope > shu-chat-message")).map((m) => (m as unknown as { message: TChatMessage }).message);

/** Open the ask pane over the bar's surface, the way the bar renders it. */
async function openPane(): Promise<Driven> {
	const el = new ShuKihanChat() as unknown as Driven;
	el.setState({ session: SESSION });
	document.body.appendChild(el);
	el.outputTarget = surface();
	await el.updateComplete;
	await new Promise((resolve) => setTimeout(resolve, 0));
	return el;
}

describe("the conversation on the bar's surface", () => {
	beforeEach(() => {
		sessionsAnswer = { sessions: [{ sessionSeqPath: SESSION, label: "the conversation", generatedAtTime: "2026-05-17T05:00:00.000Z" }] };
		turnsAnswer = null;
	});

	it("is still there when the bar is closed and opened again, without reading the store", async () => {
		document.body.innerHTML = "<shu-activity-history></shu-activity-history>";
		const first = await openPane();
		await first.handleChat("what do these have in common");
		await first.updateComplete;
		expect(onSurface().map((m) => m.text), "the turn is on the surface").toContain("what do these have in common");

		first.remove(); // the bar is closed
		const reopened = await openPane(); // and opened again
		await reopened.updateComplete;

		const texts = onSurface().map((m) => m.text);
		expect(texts, "the question a reader asked is still on screen").toContain("what do these have in common");
		expect(texts, "and so is the answer").toContain("an answer");
	});

	it("carries on from the last reply, so the next turn joins the conversation rather than starting beside it", async () => {
		document.body.innerHTML = "<shu-activity-history></shu-activity-history>";
		const first = await openPane();
		await first.handleChat("the first question");
		await first.updateComplete;
		first.remove();

		const reopened = await openPane();
		await reopened.handleChat("the question after it");
		await reopened.updateComplete;

		const texts = onSurface().map((m) => m.text);
		expect(texts).toContain("the first question");
		expect(texts).toContain("the question after it");
		expect(new Set(onSurface().map((m) => m.id)).size, "each message on the surface is its own, no id taken twice").toBe(onSurface().length);
	});

	it("is read back from the turns the store holds when the page is new, whatever the listing of other sessions does", async () => {
		// A new page has no surface to take the conversation over from, so it comes from the comments the turns were
		// written as. The listing of every other session never answers here: the conversation does not wait on it.
		sessionsAnswer = null;
		turnsAnswer = { turns: [{ prompt: "the question before the reload", response: "the answer to it", seqPath: SESSION }] };
		document.body.innerHTML = "<shu-activity-history></shu-activity-history>";
		const el = await openPane();
		await el.updateComplete;

		const texts = onSurface().map((m) => m.text);
		expect(texts, "the question is back").toContain("the question before the reload");
		expect(texts, "and the answer with it").toContain("the answer to it");
	});
});
