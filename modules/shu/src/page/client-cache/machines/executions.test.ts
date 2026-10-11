/** The table of the execution the page reads: each event from each state. */
import { describe, expect, it } from "vitest";
import { EXECUTIONS_EVENT, INITIAL_EXECUTIONS, executionsTransition, readingOf } from "./executions.js";

const choose = (execution: string | undefined) => ({ type: EXECUTIONS_EVENT.CHOOSE, execution }) as const;
const observe = (execution: string) => ({ type: EXECUTIONS_EVENT.OBSERVE, execution }) as const;

describe("the execution the page reads", () => {
	it("reads the observed execution until a reader chooses one, and the observed again when the choice is cleared", () => {
		const observed = executionsTransition(INITIAL_EXECUTIONS, observe("e1"));
		expect(readingOf(observed)).toBe("e1");
		const chosen = executionsTransition(observed, choose("e0"));
		expect(readingOf(chosen)).toBe("e0");
		expect(readingOf(executionsTransition(chosen, choose(undefined)))).toBe("e1");
	});

	it("switches at each change of choice, and leaves a repeated choice as it is", () => {
		const chosen = executionsTransition(INITIAL_EXECUTIONS, choose("e0"));
		expect(chosen.switches).toBe(1);
		expect(executionsTransition(chosen, choose("e0"))).toBe(chosen);
		expect(executionsTransition(chosen, choose(undefined)).switches).toBe(2);
	});

	it("doesn't switch where the page reads its first execution, and switches where another execution follows", () => {
		const first = executionsTransition(INITIAL_EXECUTIONS, observe("e1"));
		expect(first.switches).toBe(0);
		expect(executionsTransition(first, observe("e1"))).toBe(first);
		expect(executionsTransition(first, observe("e2")).switches).toBe(1);
	});

	it("doesn't switch where another execution is observed while a reader's choice stands", () => {
		const chosen = executionsTransition(executionsTransition(INITIAL_EXECUTIONS, observe("e1")), choose("e0"));
		expect(executionsTransition(chosen, observe("e2")).switches).toBe(chosen.switches);
	});
});
