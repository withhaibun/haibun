/**
 * What each mark says, as one related set: a verdict, a claim merely tried, or a call handed out and answered.
 *
 * Reported from a real log: a tool call a model got wrong was marked as the run failing, and the error mark beside it
 * was too small to see next to the marks around it.
 */
import { describe, expect, it } from "vitest";
import { CHECK_NO, CHECK_YES, EventFormatter, ICON_LOG_ERROR, ICON_LOG_INFO, MAYBE_CHECK_NO, MAYBE_CHECK_YES, RETURNED_TO_CALLER, type THaibunEvent } from "./protocol.js";

const step = (over: Record<string, unknown>) =>
	({ kind: "lifecycle", type: "step", stage: "end", id: "0.1.2", timestamp: 0, source: "haibun", level: "info", in: "a step", ...over }) as unknown as THaibunEvent & { kind: "lifecycle" };

describe("what a mark says", () => {
	it("marks a run's own outcome with a verdict", () => {
		expect(EventFormatter.getStatusIcon(step({ status: "completed" }))).toContain(CHECK_YES);
		expect(EventFormatter.getStatusIcon(step({ status: "failed" }))).toContain(CHECK_NO);
	});

	it("marks a claim the run merely tried with the diamond, never a verdict", () => {
		const tried = { intent: { mode: "speculative" } };
		expect(EventFormatter.getStatusIcon(step({ status: "completed", ...tried }))).toContain(MAYBE_CHECK_YES);
		const notHeld = EventFormatter.getStatusIcon(step({ status: "failed", ...tried }));
		expect(notHeld).toContain(MAYBE_CHECK_NO);
		expect(notHeld).not.toContain(CHECK_NO);
	});

	it("marks a call handed out and answered as returned, not as the run failing", () => {
		// A negative seqPath segment is a call the run handed out: a model's tool call, an RPC.
		const handedOut = EventFormatter.getStatusIcon(step({ status: "failed", id: "0.-1.2" }));
		expect(handedOut).toBe(RETURNED_TO_CALLER);
		expect(handedOut).not.toContain(CHECK_NO);
	});

	it("keeps the frequent mark quiet and the exceptional ones legible", () => {
		// Info is on every ordinary line, so it stays thin; an error must not be thinner than what surrounds it.
		expect(ICON_LOG_INFO.length).toBeLessThanOrEqual(2);
		expect(ICON_LOG_ERROR).not.toBe("⊦");
		// The error mark is distinct from the failure verdict, so a line never says failure twice in two hands.
		expect(ICON_LOG_ERROR).not.toBe(CHECK_NO);
	});
});
