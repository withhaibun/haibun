/** The table of a call of a step from its form: each event from each state. */
import { describe, expect, it } from "vitest";
import { INITIAL_STEP_CALL, STEP_CALL_EVENT, STEP_CALL_STATUS, stepCallTransition, type TStepCallState } from "./step-call.js";

const REFUSAL = { error: "the site refuses" };
const CALLING: TStepCallState = { status: STEP_CALL_STATUS.CALLING };
const RETURNED: TStepCallState = { status: STEP_CALL_STATUS.RETURNED, result: { done: true } };
const INVALID: TStepCallState = { status: STEP_CALL_STATUS.INVALID, refusal: { error: "invalid input: did required" }, fieldErrors: { did: "required" } };
const FAILED: TStepCallState = { status: STEP_CALL_STATUS.FAILED, refusal: REFUSAL };

describe("a call of a step from its form", () => {
	it("starts a call from each state but a call under way", () => {
		for (const state of [INITIAL_STEP_CALL, INVALID, RETURNED, FAILED]) expect(stepCallTransition(state, { type: STEP_CALL_EVENT.CALL })).toEqual(CALLING);
		expect(stepCallTransition(CALLING, { type: STEP_CALL_EVENT.CALL })).toBe(CALLING);
	});

	it("refuses the form's values in each state but a call under way", () => {
		const event = { type: STEP_CALL_EVENT.REFUSE_INPUT, refusal: { error: "invalid input: did required" }, fieldErrors: { did: "required" } };
		for (const state of [INITIAL_STEP_CALL, RETURNED, FAILED]) expect(stepCallTransition(state, event)).toEqual(INVALID);
		expect(stepCallTransition(CALLING, event)).toBe(CALLING);
	});

	it("ends a call under way with what the step returned, or its refusal", () => {
		expect(stepCallTransition(CALLING, { type: STEP_CALL_EVENT.RETURN, result: { done: true } })).toEqual(RETURNED);
		expect(stepCallTransition(CALLING, { type: STEP_CALL_EVENT.FAIL, refusal: REFUSAL })).toEqual(FAILED);
	});

	it("leaves a state that isn't a call under way as it is at a return or a failure", () => {
		expect(stepCallTransition(INITIAL_STEP_CALL, { type: STEP_CALL_EVENT.RETURN, result: {} })).toBe(INITIAL_STEP_CALL);
		expect(stepCallTransition(RETURNED, { type: STEP_CALL_EVENT.FAIL, refusal: REFUSAL })).toBe(RETURNED);
	});
});
