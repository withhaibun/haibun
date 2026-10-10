// @vitest-environment jsdom
/**
 * The page's event stream, as the root installs it: every view reads the installed stream, and a page that ended doesn't
 * hold one. `test/event-stream-conformance.ts` holds the one specification of what a stream sends a subscriber, and
 * `event-stream.conformance.test.ts` runs both adapters against it. The stream's status follows the stream.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { hasEventStream, installCarriedEventStream, pageEventStream, streamStatus } from "./page/root.js";
import { STREAM_STATUS } from "./page/machines/event-stream.js";
import { endPage } from "./page-pinned.js";

beforeEach(() => {
	endPage();
});

describe("the page's event stream", () => {
	it("throws with a message that names what installs one where the page doesn't hold one", () => {
		expect(hasEventStream()).toBe(false);
		expect(() => pageEventStream()).toThrow(/the page doesn't hold an event stream/);
	});

	it("is the installed stream, until the page ends", () => {
		const stream = installCarriedEventStream();
		expect(pageEventStream()).toBe(stream);
		endPage();
		expect(hasEventStream()).toBe(false);
	});

	it("states its status: open as it opens, reconnecting after a break, open again, and closed once closed", () => {
		const stream = installCarriedEventStream();
		expect(streamStatus().state.get()).toBe(STREAM_STATUS.OPEN);
		stream.disconnect();
		expect(streamStatus().state.get()).toBe(STREAM_STATUS.RECONNECTING);
		stream.reconnect();
		expect(streamStatus().state.get()).toBe(STREAM_STATUS.OPEN);
		stream.close();
		expect(streamStatus().state.get()).toBe(STREAM_STATUS.CLOSED);
	});
});
