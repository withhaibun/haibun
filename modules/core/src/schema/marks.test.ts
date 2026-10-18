/**
 * Tests what each mark indicates. The marks form one related set: the verdicts, the diamonds of a tried claim, the return
 * arrow of a failed call actuality handed out, and the log marks.
 *
 * Two of the tests cover faults found in a log. A model's failed tool call showed the mark of actuality failing, and the
 * error mark was too small to see beside the marks around it.
 */
import { describe, expect, it } from "vitest";
import {
	CHECK_NO,
	CHECK_YES,
	EventFormatter,
	ICON_LOG_ERROR,
	ICON_LOG_INFO,
	MAYBE_CHECK_NO,
	MAYBE_CHECK_YES,
	RETURNED_TO_CALLER,
	type THaibunEvent,
} from "../lib/domains/protocol.js";

const step = (over: Record<string, unknown>) =>
	({ kind: "lifecycle", type: "step", stage: "end", id: "0.1.2", timestamp: 0, source: "haibun", level: "info", in: "a step", ...over }) as unknown as THaibunEvent & {
		kind: "lifecycle";
	};

describe("what a mark indicates", () => {
	it("marks actuality's own outcome with a verdict", () => {
		expect(EventFormatter.getStatusIcon(step({ status: "completed" }))).toContain(CHECK_YES);
		expect(EventFormatter.getStatusIcon(step({ status: "failed" }))).toContain(CHECK_NO);
	});

	it("marks a claim actuality tried with the diamond, not a verdict", () => {
		const tried = { intent: { mode: "speculative" } };
		expect(EventFormatter.getStatusIcon(step({ status: "completed", ...tried }))).toContain(MAYBE_CHECK_YES);
		const notHeld = EventFormatter.getStatusIcon(step({ status: "failed", ...tried }));
		expect(notHeld).toContain(MAYBE_CHECK_NO);
		expect(notHeld).not.toContain(CHECK_NO);
	});

	it("marks a failed call actuality handed out as returned, not as actuality failing", () => {
		// A negative seqPath segment marks a call actuality handed out, such as a model's tool call or an RPC.
		const handedOut = EventFormatter.getStatusIcon(step({ status: "failed", id: "0.-1.2" }));
		expect(handedOut).toBe(RETURNED_TO_CALLER);
		expect(handedOut).not.toContain(CHECK_NO);
	});

	it("keeps the frequent mark thin and the exceptional ones legible", () => {
		// The info mark is on every ordinary log line, so it stays thin. The error mark must not be thinner than the marks around it.
		expect(ICON_LOG_INFO.length).toBeLessThanOrEqual(2);
		expect(ICON_LOG_ERROR).not.toBe("⊦");
		// The error mark differs from the failure verdict, so an error log line doesn't show a second failure verdict.
		expect(ICON_LOG_ERROR).not.toBe(CHECK_NO);
	});
});
