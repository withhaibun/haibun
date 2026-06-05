// @vitest-environment jsdom
/**
 * Locks the `EventStream` contract: subscribe/replay semantics, filtering,
 * the accessor's not-installed failure mode, and `SerializedEventStream`'s
 * emit ordering. `LiveEventStream` against a real EventSource is exercised
 * by the component integration tests; this covers the pure in-memory
 * surface so regressions in the contract fail immediately.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eventStream, setEventStream, resetEventStream, SerializedEventStream, type TEvent } from "./event-stream.js";

beforeEach(() => {
	resetEventStream();
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

	it("resetEventStream returns to the not-installed state", () => {
		setEventStream(new SerializedEventStream());
		resetEventStream();
		expect(() => eventStream()).toThrow(/no EventStream installed/);
	});
});

describe("SerializedEventStream.subscribe + emit", () => {
	it("delivers every emit after subscribe, in order", () => {
		const s = new SerializedEventStream();
		const seen: TEvent[] = [];
		s.subscribe((e) => seen.push(e));
		s.emit({ kind: "lifecycle", type: "step", stage: "start" });
		s.emit({ kind: "lifecycle", type: "step", stage: "end", status: "completed" });
		expect(seen.map((e) => e.stage)).toEqual(["start", "end"]);
	});

	it("subscribers registered AFTER emits receive the full history in order before any new event", () => {
		const s = new SerializedEventStream();
		s.emit({ id: 1 });
		s.emit({ id: 2 });
		const seen: TEvent[] = [];
		s.subscribe((e) => seen.push(e));
		s.emit({ id: 3 });
		expect(seen.map((e) => e.id)).toEqual([1, 2, 3]);
	});

	it("filter narrows what reaches the handler — both during replay and on live emits", () => {
		const s = new SerializedEventStream();
		s.emit({ kind: "log" });
		s.emit({ kind: "lifecycle" });
		const seen: TEvent[] = [];
		s.subscribe(
			(e) => seen.push(e),
			(e) => e.kind === "lifecycle",
		);
		s.emit({ kind: "log" });
		s.emit({ kind: "lifecycle", stage: "end" });
		expect(seen.map((e) => e.kind)).toEqual(["lifecycle", "lifecycle"]);
	});

	it("unsubscribe stops further dispatch but does not affect other subscribers", () => {
		const s = new SerializedEventStream();
		const a: TEvent[] = [];
		const b: TEvent[] = [];
		const offA = s.subscribe((e) => a.push(e));
		s.subscribe((e) => b.push(e));
		s.emit({ id: 1 });
		offA();
		s.emit({ id: 2 });
		expect(a.map((e) => e.id)).toEqual([1]);
		expect(b.map((e) => e.id)).toEqual([1, 2]);
	});

	it("totalRecorded counts every emit, replay or not", () => {
		const s = new SerializedEventStream();
		expect(s.totalRecorded()).toBe(0);
		s.emit({ id: 1 });
		s.emit({ id: 2 });
		expect(s.totalRecorded()).toBe(2);
		s.subscribe(() => undefined);
		expect(s.totalRecorded()).toBe(2);
		s.emit({ id: 3 });
		expect(s.totalRecorded()).toBe(3);
	});

	it("close clears subscribers — subsequent emits reach nothing", () => {
		const s = new SerializedEventStream();
		const seen: TEvent[] = [];
		s.subscribe((e) => seen.push(e));
		s.close();
		s.emit({ id: 1 });
		expect(seen).toEqual([]);
	});
});
