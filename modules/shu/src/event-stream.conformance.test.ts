// @vitest-environment jsdom
// Runs one specification against both adapters of the page's event stream. The live one reads the host's stream, and a
// report and a scripted scenario drive the carried one.
import { PAGE_ACTUALITY, hydrate, newPage, servedWith } from "./test/setup.js";
import { vi, expect } from "vitest";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { installCarriedEventStream, installServedEventStream } from "./page/root.js";
import { type TEvent } from "./page/ports.js";
import { hydrateFromDom } from "./page/controllers/hydration-controller.js";
import { SSE_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { describeEventStream } from "./test/event-stream-conformance.js";

describeEventStream("a log the page carries", () => {
	const stream = installCarriedEventStream();
	stream.connect();
	return { stream, deliver: (e: TEvent) => stream.emit(e), breakStream: () => stream.disconnect(), restore: () => stream.reconnect() };
});

/**
 * Stubs the host's stream for the case. Each connection the page requests receives a response body. The case writes
 * messages to that body. A break closes the body the page reads. The page's next request is held until the case restores
 * the stream, so a case can inspect the stream while it is down.
 */
describeEventStream("a live connection", async () => {
	newPage();
	const hydration = hydrate({ actualityId: PAGE_ACTUALITY, settings: servedWith({ streamReconnectAfterMs: 1 }) });
	hydrateFromDom();
	const bodies: Array<{ body: ReadableStreamDefaultController<Uint8Array>; read: boolean }> = [];
	const held: Array<() => void> = [];
	vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
		const answer = () => {
			const connection = { body: undefined as unknown as ReadableStreamDefaultController<Uint8Array>, read: true };
			const body = new ReadableStream<Uint8Array>({ start: (controller) => void (connection.body = controller) });
			bodies.push(connection);
			// The stream's `close` aborts the request. The page doesn't read this connection after the abort.
			init?.signal?.addEventListener("abort", () => void (connection.read = false));
			return new Response(body, { status: 200 });
		};
		return bodies.length === 0 ? Promise.resolve(answer()) : new Promise<Response>((resolve) => held.push(() => resolve(answer())));
	});
	const stream = installServedEventStream(SSE_ROUTE);
	let opens = 0;
	let breaks = 0;
	stream.opened(() => opens++);
	stream.disconnected(() => breaks++);
	stream.connect();
	await vi.waitFor(() => expect(opens).toBe(1));
	const newest = () => itemAt(bodies, bodies.length - 1);
	return {
		stream,
		deliver: async (e: TEvent) => {
			const recorded = stream.totalRecorded();
			newest().body.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({ type: "event", event: e })}\n\n`));
			if (newest().read) await vi.waitFor(() => expect(stream.totalRecorded()).toBe(recorded + 1));
		},
		breakStream: async () => {
			const broken = breaks;
			newest().body.close();
			await vi.waitFor(() => expect(breaks).toBe(broken + 1));
			await vi.waitFor(() => expect(held).toHaveLength(1)); // the page requests the stream again and waits for the host
		},
		restore: async () => {
			const opened = opens;
			held.shift()?.();
			await vi.waitFor(() => expect(opens).toBe(opened + 1));
		},
		done: () => {
			vi.unstubAllGlobals();
			hydration.remove();
		},
	};
});
