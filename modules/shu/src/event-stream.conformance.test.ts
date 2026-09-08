// @vitest-environment jsdom
// Both implementations of the page's event stream, held to one specification: the live one over an EventSource, and
// the serialized one a report and a scripted scenario drive.
import { vi } from "vitest";
import { LiveEventStream, SerializedEventStream, type TEvent } from "./event-stream.js";
import { describeEventStream } from "./test/event-stream-conformance.js";

describeEventStream("a log the page carries", () => {
	const stream = new SerializedEventStream();
	stream.connect();
	return { stream, deliver: (e: TEvent) => stream.emit(e), breakStream: () => stream.disconnect(), restore: () => stream.reconnect() };
});

/** An EventSource the case drives: the subscriber's handlers are what a wire message, a break and a return arrive on.
 *  A closed source keeps its handlers, so a case can push on a connection the page has stopped reading. */
class MockEventSource {
	static last: MockEventSource | undefined;
	onmessage: ((e: { data: string }) => void) | null = null;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(readonly url: string) {
		MockEventSource.last = this;
	}
	close(): void {
		/* the fake source holds no connection to release */
	}
}
const newest = (): MockEventSource => MockEventSource.last as MockEventSource;
/** How long the subscriber waits before opening the connection again, which a case advances rather than waits out. */
const RECONNECT_MS = 2000;

describeEventStream("a live connection", () => {
	MockEventSource.last = undefined;
	vi.useFakeTimers();
	(globalThis as { EventSource?: unknown }).EventSource = MockEventSource;
	const stream = new LiveEventStream("/sse");
	stream.connect();
	return {
		stream,
		deliver: (e: TEvent) => newest().onmessage?.({ data: JSON.stringify({ type: "event", event: e }) }),
		breakStream: () => newest().onerror?.(),
		restore: () => {
			vi.advanceTimersByTime(RECONNECT_MS); // the subscriber opens the connection again on its own delay
			newest().onopen?.();
		},
		done: () => {
			vi.useRealTimers();
			(globalThis as { EventSource?: unknown }).EventSource = undefined;
		},
	};
});
