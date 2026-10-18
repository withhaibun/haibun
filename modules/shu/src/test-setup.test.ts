// @vitest-environment jsdom
/**
 * Locks `setupShuTest` behaviour: installs both services, default dispatch
 * throws with a precise message naming the unconfigured method, custom
 * dispatch is honoured, emit reaches eventStream subscribers, and teardown
 * un-installs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { acts } from "./page/domains/links.js";
import { conduit } from "./page/controllers/conduit-controller.js";
import { pageEventStream } from "./page/root.js";
import { setupShuTest } from "./test/setup.js";

beforeEach(() => {
	// Each test re-runs setupShuTest; state doesn't leak between cases.
});

describe("setupShuTest", () => {
	it("installs a conduit and an event stream, so conduit() and pageEventStream() don't throw", () => {
		setupShuTest();
		expect(conduit()).toBeDefined();
		expect(pageEventStream()).toBeDefined();
	});

	it("default dispatch throws with the missing method name when a test doesn't configure `dispatch`", async () => {
		setupShuTest();
		await expect(conduit().follow(acts("Nothing-configured"), "test")).rejects.toThrow(/a dispatch for "Nothing-configured" isn't configured/);
	});

	it("custom dispatch returns wire results to follow()", async () => {
		setupShuTest({ dispatch: (method) => ({ _type: method }) });
		const rep = await conduit().follow<{ _type: string }>(acts("X"), "test");
		expect(rep._type).toBe("X");
	});

	it("emit reaches eventStream subscribers in order", () => {
		const h = setupShuTest();
		const seen: number[] = [];
		pageEventStream().subscribe((e) => seen.push(e.id as number));
		h.emit({ id: 1 });
		h.emit({ id: 2 });
		expect(seen).toEqual([1, 2]);
	});

	it("teardown un-installs both services, subsequent accessor calls throw", () => {
		const h = setupShuTest();
		h.teardown();
		expect(() => conduit()).toThrow(/the page doesn't hold a conduit/);
		expect(() => pageEventStream()).toThrow(/the page doesn't hold an event stream/);
	});

	it("a second setupShuTest replaces the prior instances cleanly", () => {
		const first = setupShuTest();
		const second = setupShuTest();
		expect(conduit()).toBe(second.conduit);
		expect(pageEventStream()).toBe(second.eventStream);
		expect(first.conduit).not.toBe(second.conduit);
	});
});
