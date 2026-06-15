// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { tracesToModel } from "./shu-sequence-diagram.js";
import type { TDispatchTrace } from "../schemas.js";

const trace = (over: Partial<TDispatchTrace>): TDispatchTrace => ({ stepName: "step", transport: "local", authorized: true, ...over }) as TDispatchTrace;

describe("tracesToModel", () => {
	it("opens Feature plus one actor per distinct transport target (deduped, in first-seen order)", () => {
		const { model } = tracesToModel([
			trace({ transport: "local" }),
			trace({ transport: "remote", remoteHost: "h.example" }),
			trace({ transport: "remote", remoteHost: "h.example" }),
			trace({ transport: "subprocess" }),
		]);
		expect(model.actors.map((a) => a.id)).toEqual(["Feature", "Local", "h.example", "Subprocess"]);
	});

	it("an authorized call emits a call then a return; the return carries product keys", () => {
		const { model, timestamps } = tracesToModel([trace({ stepName: "doThing", durationMs: 5, productKeys: ["a", "b"], timestamp: 10 })]);
		expect(model.messages).toEqual([
			{ from: "Feature", to: "Local", label: "doThing (5ms)", kind: "call", note: undefined },
			{ from: "Local", to: "Feature", label: "ok {a, b}", kind: "return" },
		]);
		expect(timestamps).toEqual([10, 10]); // both messages share their trace's timestamp, indexed by data-index
	});

	it("a required+granted capability annotates the call with a note", () => {
		const { model } = tracesToModel([trace({ capabilityRequired: "write", capabilityGranted: ["alice"] })]);
		expect(model.messages[0].note).toBe("write ✓ alice");
	});

	it("an unauthorized capability is a single denied message, no return", () => {
		const { model } = tracesToModel([trace({ stepName: "blocked", capabilityRequired: "write", authorized: false })]);
		expect(model.messages).toEqual([{ from: "Feature", to: "Local", label: "blocked", kind: "denied", note: "denied: write" }]);
	});
});
