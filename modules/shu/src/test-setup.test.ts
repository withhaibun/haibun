// @vitest-environment jsdom
/**
 * Locks `setupShuTest` behaviour: installs both services, default dispatch
 * throws with a precise message naming the unconfigured method, custom
 * dispatch is honoured, emit reaches eventStream subscribers, and teardown
 * un-installs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { conduit } from "./hypermedia.js";
import { eventStream } from "./event-stream.js";
import { setupShuTest } from "./test-setup.js";

beforeEach(() => {
	// Each test re-runs setupShuTest; nothing leaks between cases.
});

describe("setupShuTest", () => {
	it("installs a Conduit and EventStream — conduit() and eventStream() no longer throw", () => {
		setupShuTest();
		expect(conduit()).toBeDefined();
		expect(eventStream()).toBeDefined();
	});

	it("default dispatch throws with the missing method name when no `dispatch` is configured", async () => {
		setupShuTest();
		await expect(conduit().follow({ method: "Nothing-configured" }, "test")).rejects.toThrow(/no dispatch configured for "Nothing-configured"/);
	});

	it("custom dispatch returns wire results to follow()", async () => {
		setupShuTest({ dispatch: (method) => ({ _type: method }) });
		const rep = await conduit().follow<{ _type: string }>({ method: "X" }, "test");
		expect(rep._type).toBe("X");
	});

	it("emit reaches eventStream subscribers in order", () => {
		const h = setupShuTest();
		const seen: number[] = [];
		eventStream().subscribe((e) => seen.push(e.id as number));
		h.emit({ id: 1 });
		h.emit({ id: 2 });
		expect(seen).toEqual([1, 2]);
	});

	it("teardown un-installs both services — subsequent accessor calls throw", () => {
		const h = setupShuTest();
		h.teardown();
		expect(() => conduit()).toThrow(/no Conduit installed/);
		expect(() => eventStream()).toThrow(/no EventStream installed/);
	});

	it("a second setupShuTest replaces the prior instances cleanly", () => {
		const first = setupShuTest();
		const second = setupShuTest();
		expect(conduit()).toBe(second.conduit);
		expect(eventStream()).toBe(second.eventStream);
		expect(first.conduit).not.toBe(second.conduit);
	});
});
