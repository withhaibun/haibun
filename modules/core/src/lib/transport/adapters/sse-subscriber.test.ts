import { describe, expect, it, vi } from "vitest";
import { SseSubscriber } from "./sse-subscriber.js";
import type { THaibunEvent } from "../../domains/protocol.js";
import { newActualityId } from "../ports.js";
import { itemAt } from "../../util/item-at.js";

const ACTUALITY = newActualityId();

/** A host's stream that the test drives. It records each connection the subscriber requests, the request's headers, and
 *  the body that the test writes messages into or ends. A connection requested while `refusing` receives a 401
 *  response, as a host refuses a stream to a caller that doesn't hold the authority it requires. */
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
	it("unwraps each message's envelope and dispatches the event", async () => {
		const { host, fetchImpl } = hostStreams();
		const sub = new SseSubscriber({ url: "/sse", actualityId: ACTUALITY, fetchImpl });
		const received: THaibunEvent[] = [];
		sub.subscribe((e) => received.push(e));
		sub.connect();
		await vi.waitFor(() => expect(host.connections).toHaveLength(1));
		itemAt(host.connections, 0).send(wire({ id: "live-1", kind: "lifecycle", timestamp: 2 }));
		itemAt(host.connections, 0).send(wire({ id: "live-2", kind: "lifecycle", timestamp: 3 }));
		await vi.waitFor(() => expect(received.map((e) => e.id)).toEqual(["live-1", "live-2"]));
		sub.close();
	});

	it("requests each connection with headers made for that request, since a proof covers one request", async () => {
		const { host, fetchImpl } = hostStreams();
		let made = 0;
		const sub = new SseSubscriber({
			url: "/sse",
			actualityId: ACTUALITY,
			reconnectDelayMs: 0,
			fetchImpl,
			headers: (url) => Promise.resolve({ "capability-invocation": `${url} ${++made}` }),
		});
		sub.connect();
		await vi.waitFor(() => expect(host.connections).toHaveLength(1));
		itemAt(host.connections, 0).end();
		await vi.waitFor(() => expect(host.connections).toHaveLength(2));
		expect(host.connections.map((c) => c.headers["capability-invocation"])).toEqual(["/sse 1", "/sse 2"]);
		expect(itemAt(host.connections, 0).headers.accept, "and sends an accept header for an event stream").toBe("text/event-stream");
		sub.close();
	});
});

describe("SseSubscriber reconnection after a break", () => {
	it("doesn't call a reconnected listener on the first open, and calls it once on a re-open after the stream drops", async () => {
		const { host, fetchImpl } = hostStreams();
		const sub = new SseSubscriber({ url: "/sse", actualityId: ACTUALITY, reconnectDelayMs: 0, fetchImpl });
		let caughtUp = 0;
		let opened = 0;
		sub.reconnected(() => caughtUp++);
		sub.opened(() => opened++);
		sub.connect();
		await vi.waitFor(() => expect(opened).toBe(1));
		expect(caughtUp).toBe(0);
		itemAt(host.connections, 0).end();
		await vi.waitFor(() => expect(opened).toBe(2));
		expect(caughtUp).toBe(1);
		sub.close();
	});

	it("doesn't call a reconnected listener after its unsubscribe runs", async () => {
		const { host, fetchImpl } = hostStreams();
		const sub = new SseSubscriber({ url: "/sse", actualityId: ACTUALITY, reconnectDelayMs: 0, fetchImpl });
		let caughtUp = 0;
		let opened = 0;
		const stop = sub.reconnected(() => caughtUp++);
		sub.opened(() => opened++);
		sub.connect();
		await vi.waitFor(() => expect(opened).toBe(1));
		stop();
		itemAt(host.connections, 0).end();
		await vi.waitFor(() => expect(opened).toBe(2));
		expect(caughtUp).toBe(0);
		sub.close();
	});

	it("leaves a refused connection down and doesn't request it again, since the host's response to its caller doesn't change", async () => {
		const { host, fetchImpl } = hostStreams();
		host.refusing = true;
		let asked = 0;
		const counting: typeof fetch = (url, init) => {
			asked++;
			return fetchImpl(url, init);
		};
		const sub = new SseSubscriber({ url: "/sse", actualityId: ACTUALITY, reconnectDelayMs: 0, fetchImpl: counting });
		let down = 0;
		sub.disconnected(() => down++);
		sub.connect();
		await vi.waitFor(() => expect(down).toBe(1));
		// One turn of the event loop. A retry with a zero delay would request the stream again within it.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(asked, "requested once").toBe(1);
		sub.close();
	});

	it("treats a failed connection as a break and requests it again after the delay", async () => {
		const { host, fetchImpl } = hostStreams();
		let failing = true;
		const flaky: typeof fetch = (url, init) => (failing ? Promise.reject(new TypeError("fetch failed")) : fetchImpl(url, init));
		const sub = new SseSubscriber({ url: "/sse", actualityId: ACTUALITY, reconnectDelayMs: 0, fetchImpl: flaky });
		let down = 0;
		sub.disconnected(() => down++);
		sub.connect();
		await vi.waitFor(() => expect(down).toBe(1));
		failing = false;
		await vi.waitFor(() => expect(host.connections).toHaveLength(1));
		sub.close();
	});
});
