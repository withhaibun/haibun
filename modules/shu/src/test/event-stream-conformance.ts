/**
 * One specification, every event stream. A view subscribes through `eventStream()` and does not know which
 * implementation is installed: the live one over `/sse`, or the serialized one a report and a scripted scenario drive.
 * A difference between them is a difference in what a view is told, so each answers these cases rather than carrying a
 * suite of its own.
 *
 * What is specified is what a subscriber is told: the events, in order, including those that arrived before it
 * subscribed; what a filter narrows; what an unsubscribed handler stops receiving; how many events were recorded; and
 * what says the stream broke and came back. How events reach the stream is its own: a wire message for the live one,
 * `emit` for the serialized one, which is what `TStreamUnderTest` supplies.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { EventStream, TEvent } from "../event-stream.js";

/** A stream ready to subscribe to, with the operations that drive it. Each is awaited, so an implementation that
 *  reconnects on a timer advances that timer here rather than in a case. */
export type TStreamUnderTest = {
	stream: EventStream;
	/** Deliver one event through the stream, as the server delivers one. */
	deliver(event: TEvent): Promise<void> | void;
	/** Break the connection. */
	breakStream(): Promise<void> | void;
	/** Bring the connection back. */
	restore(): Promise<void> | void;
	done?(): void | Promise<void>;
};

const event = (n: number): TEvent => ({ level: n % 2 === 0 ? "info" : "debug", message: `event ${n}` });
const messages = (got: TEvent[]): string[] => got.map((e) => String(e.message));

/** Run the specification against one stream. `make` returns a connected stream with nothing delivered yet. */
export function describeEventStream(name: string, make: () => TStreamUnderTest | Promise<TStreamUnderTest>): void {
	describe(`the event stream (${name})`, () => {
		let held: TStreamUnderTest;
		let stream: EventStream;
		beforeEach(async () => {
			held = await make();
			stream = held.stream;
			return async () => {
				stream.close();
				await held.done?.();
			};
		});

		it("tells a subscriber every event, in the order the stream carried them", async () => {
			const got: TEvent[] = [];
			stream.subscribe((e) => got.push(e));
			await held.deliver(event(1));
			await held.deliver(event(2));
			expect(messages(got)).toEqual(["event 1", "event 2"]);
		});

		it("tells a subscriber what arrived before it subscribed, before anything that arrives after", async () => {
			await held.deliver(event(1));
			const got: TEvent[] = [];
			stream.subscribe((e) => got.push(e));
			await held.deliver(event(2));
			expect(messages(got)).toEqual(["event 1", "event 2"]);
		});

		it("gives a filtered subscriber only what its filter passes, of what arrived before and after it subscribed", async () => {
			await held.deliver(event(1));
			await held.deliver(event(2));
			const got: TEvent[] = [];
			stream.subscribe(
				(e) => got.push(e),
				(e) => e.level === "info",
			);
			await held.deliver(event(3));
			await held.deliver(event(4));
			expect(messages(got)).toEqual(["event 2", "event 4"]);
		});

		it("tells a handler nothing after it unsubscribes, and keeps telling the others", async () => {
			const first: TEvent[] = [];
			const second: TEvent[] = [];
			const stop = stream.subscribe((e) => first.push(e));
			stream.subscribe((e) => second.push(e));
			await held.deliver(event(1));
			stop();
			await held.deliver(event(2));
			expect(messages(first)).toEqual(["event 1"]);
			expect(messages(second)).toEqual(["event 1", "event 2"]);
		});

		it("counts every event it has recorded", async () => {
			expect(stream.totalRecorded()).toBe(0);
			await held.deliver(event(1));
			await held.deliver(event(2));
			expect(stream.totalRecorded()).toBe(2);
		});

		it("tells a listener the stream broke, once for the break", async () => {
			let told = 0;
			stream.disconnected(() => told++);
			await held.breakStream();
			expect(told).toBe(1);
		});

		it("tells a listener that starts after the break that the stream is down, so no view believes it is current", async () => {
			await held.breakStream();
			let told = 0;
			stream.disconnected(() => told++);
			expect(told).toBe(1);
		});

		it("tells a listener the stream came back, which is when a view has something to read again for", async () => {
			let told = 0;
			stream.reconnected(() => told++);
			await held.breakStream();
			expect(told, "a break is not a return").toBe(0);
			await held.restore();
			expect(told).toBe(1);
		});

		it("tells a listener nothing about the connection after it unsubscribes", async () => {
			let broke = 0;
			let returned = 0;
			stream.disconnected(() => broke++)();
			stream.reconnected(() => returned++)();
			await held.breakStream();
			await held.restore();
			expect([broke, returned]).toEqual([0, 0]);
		});

		it("tells nothing to any subscriber once it is closed", async () => {
			const got: TEvent[] = [];
			stream.subscribe((e) => got.push(e));
			stream.close();
			await held.deliver(event(1));
			expect(got).toEqual([]);
		});
	});
}
