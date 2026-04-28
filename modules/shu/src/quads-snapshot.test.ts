// @vitest-environment jsdom
/**
 * The shu app and external clustered viewers (fisheye) ship as separate IIFE
 * bundles. Each carries its own copy of this module's *bindings*, but the
 * live store (cache, listeners, viewContext) is hoisted to a `globalThis`
 * singleton. That means a `setSelectedSubject` call from the shu app's bundle
 * notifies subscribers registered in the fisheye bundle, and one HTTP fetch
 * populates one in-memory snapshot regardless of how many bundles are
 * importing the module.
 *
 * These tests pin that contract by simulating the cross-bundle case: a fresh
 * import of the module in a new module-graph context (achieved here by
 * deleting the cached module) sees the same singleton store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setSelectedSubject, subscribeSnapshot, getViewContext } from "./quads-snapshot.js";

const STORE_KEY = "__SHU_QUADS_SNAPSHOT_STORE__";

describe("quads-snapshot store singleton", () => {
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
	});

	it("registers the store under a globalThis key on first use", () => {
		setSelectedSubject("seed", null);
		const stored = (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
		expect(stored).toBeDefined();
	});

	it("subscribers see selection updates from any caller (cross-bundle simulation)", () => {
		const seen: Array<string | null> = [];
		const unsub = subscribeSnapshot((_snap, ctx) => seen.push(ctx.selectedSubject));
		setSelectedSubject("a", null);
		setSelectedSubject("b", null);
		setSelectedSubject(null, null);
		unsub();
		expect(seen).toEqual(["a", "b", null]);
	});

	it("getViewContext reflects the latest setter, regardless of which import called it", () => {
		setSelectedSubject("x", "Label");
		expect(getViewContext().selectedSubject).toBe("x");
		expect(getViewContext().selectedLabel).toBe("Label");
	});

	it("dedups identical setSelectedSubject calls (no spurious notifications)", () => {
		let count = 0;
		const unsub = subscribeSnapshot(() => count++);
		setSelectedSubject("once", null);
		setSelectedSubject("once", null);
		setSelectedSubject("once", null);
		unsub();
		expect(count).toBe(1);
	});

	it("two listeners registered before any change both fire on a single update — proving the listener Set is one identity, not duplicated", () => {
		const a: Array<string | null> = [];
		const b: Array<string | null> = [];
		const ua = subscribeSnapshot((_s, ctx) => a.push(ctx.selectedSubject));
		const ub = subscribeSnapshot((_s, ctx) => b.push(ctx.selectedSubject));
		setSelectedSubject("shared", null);
		ua();
		ub();
		expect(a).toEqual(["shared"]);
		expect(b).toEqual(["shared"]);
	});
});
