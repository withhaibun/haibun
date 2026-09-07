import { describe, expect, it } from "vitest";
import { SseSubscriber } from "./sse-subscriber.js";
import type { THaibunEvent } from "../schema/protocol.js";

/** Minimal EventSource stand-in: captures the message handler and named listeners so a test can push wire events. */
class MockEventSource {
	static instances: MockEventSource[] = [];
	onmessage: ((e: { data: string }) => void) | null = null;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	private named = new Map<string, (e: { data: string }) => void>();
	constructor(public url: string) {
		MockEventSource.instances.push(this);
	}
	addEventListener(name: string, handler: (e: { data: string }) => void): void {
		this.named.set(name, handler);
	}
	emit(name: string, data: string): void {
		if (name === "message") this.onmessage?.({ data });
		else this.named.get(name)?.({ data });
	}
	close(): void {
		// the fake source holds no connection to release
	}
}

const wire = (event: Record<string, unknown>): string => JSON.stringify({ type: "event", event });

describe("SseSubscriber delivery", () => {
	it("dispatches each message the stream carries, unwrapped", () => {
		MockEventSource.instances = [];
		const sub = new SseSubscriber({ url: "/sse", EventSourceCtor: MockEventSource as unknown as new (url: string) => unknown as never });
		const received: THaibunEvent[] = [];
		sub.subscribe((e) => received.push(e));
		sub.connect();
		MockEventSource.instances[0].emit("message", wire({ id: "live-1", kind: "lifecycle", timestamp: 2 }));
		expect(received.map((e) => e.id)).toEqual(["live-1"]);
	});
});

describe("SseSubscriber catching up after a break", () => {
	it("the first open announces nothing, and a re-open after the stream drops announces once", () => {
		MockEventSource.instances = [];
		const sub = new SseSubscriber({ url: "/sse", reconnectDelayMs: 0, EventSourceCtor: MockEventSource as unknown as new (url: string) => unknown as never });
		let caughtUp = 0;
		sub.reconnected(() => caughtUp++);
		sub.connect();
		MockEventSource.instances[0].onopen?.();
		expect(caughtUp).toBe(0);
		MockEventSource.instances[0].onerror?.();
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				MockEventSource.instances[1].onopen?.();
				expect(caughtUp).toBe(1);
				MockEventSource.instances[1].onopen?.();
				expect(caughtUp).toBe(1);
				sub.close();
				resolve();
			}, 0);
		});
	});

	it("stops announcing once the caller has unsubscribed", () => {
		MockEventSource.instances = [];
		const sub = new SseSubscriber({ url: "/sse", reconnectDelayMs: 0, EventSourceCtor: MockEventSource as unknown as new (url: string) => unknown as never });
		let caughtUp = 0;
		const stop = sub.reconnected(() => caughtUp++);
		sub.connect();
		stop();
		MockEventSource.instances[0].onerror?.();
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				MockEventSource.instances[1].onopen?.();
				expect(caughtUp).toBe(0);
				sub.close();
				resolve();
			}, 0);
		});
	});
});
