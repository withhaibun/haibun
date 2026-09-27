// @vitest-environment jsdom
/**
 * The accessor every view reads the stream through: what it does with no stream installed, and what it answers with
 * one. What a stream tells a subscriber is one specification both implementations run against
 * (`event-stream.conformance.test.ts`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eventStream, setEventStream, SerializedEventStream } from "./event-stream.js";
import { endPage } from "./page-pinned.js";

beforeEach(() => {
	endPage();
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

	it("a page that has ended has no event stream installed", () => {
		setEventStream(new SerializedEventStream());
		endPage();
		expect(() => eventStream()).toThrow(/no EventStream installed/);
	});
});
