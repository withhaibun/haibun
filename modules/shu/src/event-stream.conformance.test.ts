// @vitest-environment jsdom
// Both implementations of the page's event stream, held to one specification: the live one over the host's stream, and
// the serialized one a report and a scripted scenario drive.
import { vi, expect } from "vitest";
import { LiveEventStream, SerializedEventStream, type TEvent } from "./event-stream.js";
import { hydrateFromDom } from "./rpc-registry.js";
import { describeEventStream } from "./test/event-stream-conformance.js";

describeEventStream("a log the page carries", () => {
	const stream = new SerializedEventStream();
	stream.connect();
	return { stream, deliver: (e: TEvent) => stream.emit(e), breakStream: () => stream.disconnect(), restore: () => stream.reconnect() };
});

/**
 * The host's stream as the case drives it: each connection the page asks for is answered with a body the case writes
 * messages to, a break closes the body the page is reading, and the page's asking again is held until the case restores
 * the stream, so a case can look at the stream while it is down.
 */
describeEventStream("a live connection", async () => {
	const hydration = document.createElement("script");
	hydration.id = "shu-hydration";
	hydration.type = "application/json";
	hydration.textContent = JSON.stringify({ settings: { streamReconnectAfterMs: 1 } });
	document.body.append(hydration);
	hydrateFromDom();
	const bodies: Array<{ body: ReadableStreamDefaultController<Uint8Array>; read: boolean }> = [];
	const held: Array<() => void> = [];
	vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
		const answer = () => {
			const connection = { body: undefined as unknown as ReadableStreamDefaultController<Uint8Array>, read: true };
			const body = new ReadableStream<Uint8Array>({ start: (controller) => void (connection.body = controller) });
			bodies.push(connection);
			// A page that stops reading, as a closed stream does, reads nothing more of this connection.
			init?.signal?.addEventListener("abort", () => void (connection.read = false));
			return new Response(body, { status: 200 });
		};
		return bodies.length === 0 ? Promise.resolve(answer()) : new Promise<Response>((resolve) => held.push(() => resolve(answer())));
	});
	const stream = new LiveEventStream("/sse");
	let opens = 0;
	let breaks = 0;
	stream.opened(() => opens++);
	stream.disconnected(() => breaks++);
	stream.connect();
	await vi.waitFor(() => expect(opens).toBe(1));
	const newest = () => bodies[bodies.length - 1];
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
			await vi.waitFor(() => expect(held).toHaveLength(1)); // the page asks again, and waits for the host
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
