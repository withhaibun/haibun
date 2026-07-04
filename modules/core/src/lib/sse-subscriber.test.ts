import { describe, expect, it } from "vitest";
import { SseSubscriber, type TDeliveredEvent } from "./sse-subscriber.js";

/** Minimal EventSource stand-in: captures the message handler and named listeners so a test can push wire events. */
class MockEventSource {
	static instances: MockEventSource[] = [];
	onmessage: ((e: { data: string }) => void) | null = null;
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

describe("SseSubscriber replay tagging", () => {
	it("a live `message` delivery dispatches untagged; a `replay` delivery carries replay: true — so a consumer can tell a fact-about-the-past from a live occurrence", () => {
		MockEventSource.instances = [];
		const sub = new SseSubscriber({ url: "/sse", EventSourceCtor: MockEventSource as unknown as new (url: string) => unknown as never });
		const received: TDeliveredEvent[] = [];
		sub.subscribe((e) => received.push(e));
		sub.connect();
		const source = MockEventSource.instances[0];
		source.emit("replay", wire({ id: "old-1", kind: "lifecycle", timestamp: 1 }));
		source.emit("message", wire({ id: "live-1", kind: "lifecycle", timestamp: 2 }));
		expect(received.map((e) => ({ id: e.id, replay: e.replay ?? false }))).toEqual([
			{ id: "old-1", replay: true },
			{ id: "live-1", replay: false },
		]);
	});
});
