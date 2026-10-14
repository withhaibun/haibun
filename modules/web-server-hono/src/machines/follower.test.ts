/**
 * A follower's writes in flight: a follower that reads late, within the count, is kept, and one past the count is ended
 * with the reason.
 */
import { describe, expect, it } from "vitest";
import { connected, follower, readBy, sentTo } from "./follower.js";

const LIMIT = 3;

describe("a follower of the event stream", () => {
	it("is kept while it holds at most the count of writes it didn't read, and reading lowers what it holds", () => {
		const held = [1, 2, 3].reduce((state) => sentTo(state, LIMIT), connected());
		expect(held).toEqual({ inFlight: LIMIT });
		expect(readBy(held)).toEqual({ inFlight: LIMIT - 1 });
	});

	it("ends with the reason once a write would pass the count, and stays ended", () => {
		const full = [1, 2, 3].reduce((state) => sentTo(state, LIMIT), connected());
		const ended = sentTo(full, LIMIT);
		expect(ended.ended).toBe(`the follower held ${LIMIT} writes it didn't read, and a follower holds at most ${LIMIT}`);
		expect(sentTo(readBy(ended), LIMIT)).toEqual(readBy(ended));
	});

	it("refuses a read of a write that wasn't sent", () => {
		expect(() => readBy(connected())).toThrow("a follower read a write that wasn't in flight");
	});

	it("keeps a follower that reads late, within the count, through any number of writes", () => {
		const counted = follower(LIMIT);
		for (let round = 0; round < 5; round++) {
			expect([1, 2, 3].map(() => counted.sent())).toEqual([{ kept: true }, { kept: true }, { kept: true }]);
			for (let read = 0; read < LIMIT; read++) counted.written();
		}
		expect([1, 2, 3, 4].map(() => counted.sent().kept)).toEqual([true, true, true, false]);
	});
});
