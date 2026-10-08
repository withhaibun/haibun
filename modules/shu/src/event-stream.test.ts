// @vitest-environment jsdom
/**
 * Tests the `eventStream()` accessor with and without an installed stream. Every view reads the stream through this
 * accessor. `test/event-stream-conformance.ts` holds the one specification of what a stream sends a subscriber.
 * `event-stream.conformance.test.ts` runs both implementations against it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eventStream, setEventStream, SerializedEventStream } from "./event-stream.js";
import { endPage } from "./page-pinned.js";

beforeEach(() => {
	endPage();
});

describe("eventStream accessor", () => {
	it("throws with a message that names the fix when an EventStream isn't installed", () => {
		expect(() => eventStream()).toThrow(/an EventStream isn't installed/);
	});

	it("returns the installed instance after setEventStream", () => {
		const s = new SerializedEventStream();
		setEventStream(s);
		expect(eventStream()).toBe(s);
	});

	it("a page that has ended doesn't have an event stream installed", () => {
		setEventStream(new SerializedEventStream());
		endPage();
		expect(() => eventStream()).toThrow(/an EventStream isn't installed/);
	});
});
