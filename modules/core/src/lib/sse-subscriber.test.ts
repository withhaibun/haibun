import { describe, expect, it, vi } from "vitest";
import { SseSubscriber } from "./sse-subscriber.js";
import type { THaibunEvent } from "../schema/protocol.js";

/** A host's stream the case drives: each connection the subscriber asks for, what it asked with, and the body the case
 *  writes messages to or ends. A connection asked for while `refusing` is answered 401, as a host refuses a stream to a
 *  caller that doesn't hold what it requires. */
function hostStreams() {
	const connections: { url: string; headers: Record<string, string>; send: (data: string) => void; end: () => void }[] = [];
	const host = { connections, refusing: false };
	const fetchImpl = ((url: string, init?: RequestInit) => {
		if (host.refusing) return Promise.resolve(new Response("refused", { status: 401 }));
		let body!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({ start: (controller) => void (body = controller) });
		connections.push({
			url,
			headers: init?.headers as Record<string, string>,
			send: (data) => body.enqueue(new TextEncoder().encode(`event: message\ndata: ${data}\n\n`)),
			end: () => body.close(),
		});
		return Promise.resolve(new Response(stream, { status: 200 }));
	}) as typeof fetch;
	return { host, fetchImpl };
}

const wire = (event: Record<string, unknown>): string => JSON.stringify({ type: "event", event });

describe("SseSubscriber delivery", () => {
	it("dispatches each message the stream carries, unwrapped", async () => {
		const { host, fetchImpl } = hostStreams();
		const sub = new SseSubscriber({ url: "/sse", fetchImpl });
		const received: THaibunEvent[] = [];
		sub.subscribe((e) => received.push(e));
		sub.connect();
		await vi.waitFor(() => expect(host.connections).toHaveLength(1));
		host.connections[0].send(wire({ id: "live-1", kind: "lifecycle", timestamp: 2 }));
		host.connections[0].send(wire({ id: "live-2", kind: "lifecycle", timestamp: 3 }));
		await vi.waitFor(() => expect(received.map((e) => e.id)).toEqual(["live-1", "live-2"]));
		sub.close();
	});

	it("asks for each connection with the headers made for it, since a proof covers one request", async () => {
		const { host, fetchImpl } = hostStreams();
		let made = 0;
		const sub = new SseSubscriber({ url: "/sse", reconnectDelayMs: 0, fetchImpl, headers: (url) => Promise.resolve({ "capability-invocation": `${url} ${++made}` }) });
		sub.connect();
		await vi.waitFor(() => expect(host.connections).toHaveLength(1));
		host.connections[0].end();
		await vi.waitFor(() => expect(host.connections).toHaveLength(2));
		expect(host.connections.map((c) => c.headers["capability-invocation"])).toEqual(["/sse 1", "/sse 2"]);
		expect(host.connections[0].headers.accept, "and says what it reads").toBe("text/event-stream");
		sub.close();
	});
});

describe("SseSubscriber catching up after a break", () => {
	it("the first open announces nothing, and a re-open after the stream drops announces once", async () => {
		const { host, fetchImpl } = hostStreams();
		const sub = new SseSubscriber({ url: "/sse", reconnectDelayMs: 0, fetchImpl });
		let caughtUp = 0;
		let opened = 0;
		sub.reconnected(() => caughtUp++);
		sub.opened(() => opened++);
		sub.connect();
		await vi.waitFor(() => expect(opened).toBe(1));
		expect(caughtUp).toBe(0);
		host.connections[0].end();
		await vi.waitFor(() => expect(opened).toBe(2));
		expect(caughtUp).toBe(1);
		sub.close();
	});

	it("stops announcing once the caller has unsubscribed", async () => {
		const { host, fetchImpl } = hostStreams();
		const sub = new SseSubscriber({ url: "/sse", reconnectDelayMs: 0, fetchImpl });
		let caughtUp = 0;
		let opened = 0;
		const stop = sub.reconnected(() => caughtUp++);
		sub.opened(() => opened++);
		sub.connect();
		await vi.waitFor(() => expect(opened).toBe(1));
		stop();
		host.connections[0].end();
		await vi.waitFor(() => expect(opened).toBe(2));
		expect(caughtUp).toBe(0);
		sub.close();
	});

	it("a refused connection is down, and not asked for again, since the host's answer about its caller will not change", async () => {
		const { host, fetchImpl } = hostStreams();
		host.refusing = true;
		let asked = 0;
		const counting: typeof fetch = (url, init) => {
			asked++;
			return fetchImpl(url, init);
		};
		const sub = new SseSubscriber({ url: "/sse", reconnectDelayMs: 0, fetchImpl: counting });
		let down = 0;
		sub.disconnected(() => down++);
		sub.connect();
		await vi.waitFor(() => expect(down).toBe(1));
		// One turn of the event loop, in which a retry with no delay would have asked again.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(asked, "asked once").toBe(1);
		sub.close();
	});

	it("a connection that fails is a break, asked for again after the delay", async () => {
		const { host, fetchImpl } = hostStreams();
		let failing = true;
		const flaky: typeof fetch = (url, init) => (failing ? Promise.reject(new TypeError("fetch failed")) : fetchImpl(url, init));
		const sub = new SseSubscriber({ url: "/sse", reconnectDelayMs: 0, fetchImpl: flaky });
		let down = 0;
		sub.disconnected(() => down++);
		sub.connect();
		await vi.waitFor(() => expect(down).toBe(1));
		failing = false;
		await vi.waitFor(() => expect(host.connections).toHaveLength(1));
		sub.close();
	});
});
