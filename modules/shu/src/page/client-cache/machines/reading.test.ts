/** The table of a reading's currency: each event from each state. */
import { describe, expect, it } from "vitest";
import { INITIAL_READING, READING_EVENT, READING_STATUS, readingStatus, readingTransition } from "./reading.js";

describe("how current a reading is", () => {
	it("is behind from an announcement until a read begun after it settles", () => {
		const announced = readingTransition(INITIAL_READING, { type: READING_EVENT.ANNOUNCE });
		expect(readingStatus(announced)).toBe(READING_STATUS.BEHIND);
		expect(readingStatus(readingTransition(announced, { type: READING_EVENT.SETTLE, readFor: 0 })), "a read begun before it").toBe(READING_STATUS.BEHIND);
		expect(readingStatus(readingTransition(announced, { type: READING_EVENT.SETTLE, readFor: 1 }))).toBe(READING_STATUS.CURRENT);
	});

	it("keeps the newest settle, so a slower earlier read doesn't move it back", () => {
		const settled = readingTransition({ announced: 3, settled: 3, disconnected: false }, { type: READING_EVENT.SETTLE, readFor: 1 });
		expect(settled.settled).toBe(3);
	});

	it("is cut off while the stream is down, and behind once it comes back", () => {
		const down = readingTransition(INITIAL_READING, { type: READING_EVENT.DISCONNECT });
		expect(readingStatus(down)).toBe(READING_STATUS.CUT_OFF);
		expect(readingStatus(readingTransition(down, { type: READING_EVENT.RECONNECT }))).toBe(READING_STATUS.BEHIND);
	});
});
