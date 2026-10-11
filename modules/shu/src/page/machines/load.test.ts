import { describe, expect, it } from "vitest";
import { INITIAL_LOAD, LOAD_EVENT, LOAD_STATUS, loadTransition, type TLoadEvent, type TLoadState } from "./load.js";

const REFUSAL = { error: "the site refused the read" };
const after = (...events: TLoadEvent<string>[]): TLoadState<string> => events.reduce<TLoadState<string>>(loadTransition, INITIAL_LOAD);

describe("the load machine's table", () => {
	it("runs a read from pending, and ends it completed with what it read or failed with its refusal", () => {
		expect(after()).toEqual({ status: LOAD_STATUS.PENDING });
		expect(after({ type: LOAD_EVENT.START })).toEqual({ status: LOAD_STATUS.RUNNING });
		expect(after({ type: LOAD_EVENT.START }, { type: LOAD_EVENT.COMPLETE, page: "rows" })).toEqual({ status: LOAD_STATUS.COMPLETED, page: "rows" });
		expect(after({ type: LOAD_EVENT.START }, { type: LOAD_EVENT.FAIL, refusal: REFUSAL })).toEqual({ status: LOAD_STATUS.FAILED, refusal: REFUSAL });
	});

	it("starts a read again from a completed and a failed read", () => {
		expect(after({ type: LOAD_EVENT.START }, { type: LOAD_EVENT.COMPLETE, page: "rows" }, { type: LOAD_EVENT.START })).toEqual({ status: LOAD_STATUS.RUNNING });
		expect(after({ type: LOAD_EVENT.START }, { type: LOAD_EVENT.FAIL, refusal: REFUSAL }, { type: LOAD_EVENT.START })).toEqual({ status: LOAD_STATUS.RUNNING });
	});

	it("leaves the state as it is for a start of a running read, and an end of a read that isn't running", () => {
		const running = after({ type: LOAD_EVENT.START });
		expect(loadTransition(running, { type: LOAD_EVENT.START })).toBe(running);
		expect(loadTransition(INITIAL_LOAD, { type: LOAD_EVENT.COMPLETE, page: "rows" })).toBe(INITIAL_LOAD);
		const completed = after({ type: LOAD_EVENT.START }, { type: LOAD_EVENT.COMPLETE, page: "rows" });
		expect(loadTransition(completed, { type: LOAD_EVENT.FAIL, refusal: REFUSAL })).toBe(completed);
	});
});
