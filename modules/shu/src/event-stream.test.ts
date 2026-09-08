// @vitest-environment jsdom
/**
 * The accessor every view reads the stream through: what it does with no stream installed, and what it answers with
 * one. What a stream tells a subscriber is one specification both implementations run against
 * (`event-stream.conformance.test.ts`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eventStream, setEventStream, resetEventStream, SerializedEventStream } from "./event-stream.js";

beforeEach(() => {
	resetEventStream();
});

describe("eventStream accessor", () => {
	it("throws with a precise message when no EventStream has been installed", () => {
		expect(() => eventStream()).toThrow(/no EventStream installed/);
	});

	it("returns the installed instance after setEventStream", () => {
		const s = new SerializedEventStream();
		setEventStream(s);
		expect(eventStream()).toBe(s);
	});

	it("resetEventStream returns to the not-installed state", () => {
		setEventStream(new SerializedEventStream());
		resetEventStream();
		expect(() => eventStream()).toThrow(/no EventStream installed/);
	});
});
