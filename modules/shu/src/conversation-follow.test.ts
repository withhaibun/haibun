/**
 * The open conversation follows the run: a turn any page asks in it reaches every page reading it, when the run reports
 * that turn's step starting and when it reports it ending.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { question, readBack as aReadBack, rpcRegistry, hypermedia } from "./components/chat-pane.test-fake.js";
import type { TSessionTurn } from "./schemas.js";

/** The batches the run reports, raised by the case rather than by a stream. */
const stream: { onBatch?: () => void; filter?: (event: unknown) => boolean } = {};
vi.mock("./event-stream.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	hasEventStream: () => true,
	subscribeBatchedEvents: (opts: { onBatch: () => void; filter?: (event: unknown) => boolean }) => {
		stream.onBatch = opts.onBatch;
		stream.filter = opts.filter;
		return () => undefined;
	},
}));
vi.mock("./rpc-registry.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), ...rpcRegistry, isOffline: () => true }));
const read: { turns: TSessionTurn[]; reads: number } = { turns: [], reads: 0 };
vi.mock("./hypermedia.js", () =>
	hypermedia(() => {
		read.reads += 1;
		return { turns: read.turns };
	}, () => Promise.resolve()),
);

const { conversationState, dispatchConversationEvent, followRunningTurns, gainedSince, openConversation } = await import("./conversation.js");

const SESSION = question("0.1.1");
/** What the run reports for a turn's step, which is what this page hears of a turn another page asked. */
const reportOf = (stage: "start" | "end") => ({ kind: "lifecycle", type: "step", stage, actionName: "chatWithContext" });

describe("the open conversation follows the run's turns", () => {
	beforeEach(() => {
		read.reads = 0;
		read.turns = [aReadBack("0.1.1")];
		dispatchConversationEvent({ type: "close" });
		dispatchConversationEvent({ type: "open", session: SESSION });
		dispatchConversationEvent({ type: "read", session: SESSION, turns: read.turns });
	});

	it("reads the session again when the run reports a turn starting, so a turn another page asks reaches this one", async () => {
		followRunningTurns();
		expect(stream.filter?.(reportOf("start")), "a turn's step starting is reported").toBe(true);
		read.turns = [aReadBack("0.1.1"), aReadBack("0.1.2", SESSION)];
		stream.onBatch?.();
		await vi.waitFor(() => expect(conversationState.get().turns).toHaveLength(2));
	});

	it("reads it again when the run reports a turn ending", async () => {
		followRunningTurns();
		expect(stream.filter?.(reportOf("end"))).toBe(true);
		read.turns = [aReadBack("0.1.1"), aReadBack("0.1.2", SESSION)];
		stream.onBatch?.();
		await vi.waitFor(() => expect(conversationState.get().turns).toHaveLength(2));
	});

	it("names what a session gained since this page read it, and nothing once the reader opens it", async () => {
		expect(gainedSince("cmt-ask-0.9.9", 4), "a page that never opened a session has read none of it").toBe(4);
		read.turns = [aReadBack("0.9.9"), aReadBack("0.9.10", "cmt-ask-0.9.9")];
		await openConversation("cmt-ask-0.9.9", "activate");
		expect(gainedSince("cmt-ask-0.9.9", 2), "a session the reader read holds nothing new").toBe(0);
		expect(gainedSince("cmt-ask-0.9.9", 5), "and what another page asked since is what it gained").toBe(3);
	});

	it("reads nothing where no conversation is open, so a report never opens one", () => {
		dispatchConversationEvent({ type: "close" });
		followRunningTurns();
		stream.onBatch?.();
		expect(read.reads).toBe(0);
	});
});
