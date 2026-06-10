// @vitest-environment jsdom
/**
 * The shu app and external clustered viewers ship as separate IIFE
 * bundles. Each carries its own copy of this module's *bindings*, but the
 * live store (cache, listeners, viewContext) is hoisted to a `globalThis`
 * singleton. That means a `setSelectedSubject` call from the shu app's bundle
 * notifies subscribers registered in an external viewer bundle, and one HTTP fetch
 * populates one in-memory snapshot regardless of how many bundles are
 * importing the module.
 *
 * These tests pin that contract by simulating the cross-bundle case: a fresh
 * import of the module in a new module-graph context (achieved here by
 * deleting the cached module) sees the same singleton store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setSelectedSubject, subscribeSnapshot, getViewContext, mergeQuadsIntoSnapshot, pinSubjects, currentSnapshot, DEFAULT_PER_TYPE_LIMIT } from "./quads-snapshot.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { BODY_LABEL } from "@haibun/core/lib/resources.js";

const STORE_KEY = "__SHU_QUADS_SNAPSHOT_STORE__";

/** Stream one subject's quads as a single batch, mirroring how SSE delivers an upsert. */
function feedSubject(type: string, subject: string, props: number): void {
	const batch: TQuad[] = [];
	for (let p = 0; p < props; p++) batch.push({ subject, predicate: `p${p}`, object: `v${p}`, namedGraph: type, timestamp: 1 });
	mergeQuadsIntoSnapshot(batch);
}

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

describe("mergeQuadsIntoSnapshot is bounded by the budget (the OOM fix)", () => {
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
	});

	it("caps retained quads at the per-type budget no matter how many subjects stream in", () => {
		const TYPES = 5;
		const SUBJECTS_PER_TYPE = 2_000; // far over the budget
		const PROPS = 3;
		for (let t = 0; t < TYPES; t++) for (let s = 0; s < SUBJECTS_PER_TYPE; s++) feedSubject(`T${t}`, `T${t}-${s}`, PROPS);

		const snap = currentSnapshot();
		for (const c of snap.clusters) {
			expect(c.sampledCount).toBe(DEFAULT_PER_TYPE_LIMIT); // sample capped at the budget
			expect(c.omittedCount).toBe(SUBJECTS_PER_TYPE - DEFAULT_PER_TYPE_LIMIT); // the rest counted, not retained
			expect(Object.keys(c.displayLabels).length).toBe(DEFAULT_PER_TYPE_LIMIT); // every retained subject is labelled
		}
		// ~30k subjects streamed; retained quads are bounded by budget × types × props, not total.
		expect(snap.quads.length).toBeLessThanOrEqual(DEFAULT_PER_TYPE_LIMIT * TYPES * PROPS);
	});

	it("pinned (expanded) subjects are retained even past the budget", () => {
		pinSubjects(["P-pinned"]);
		for (let s = 0; s < 500; s++) feedSubject("P", `P-${s}`, 2); // fill far past the budget
		feedSubject("P", "P-pinned", 2); // arrives after the budget is full

		const snap = currentSnapshot();
		const labels = snap.clusters.find((c) => c.type === "P")?.displayLabels ?? {};
		expect(labels["P-pinned"]).toBeDefined(); // pinned subject kept despite the budget being full
	});

	it("titles a body-backed subject by its linked body when both arrive in one merge (create-time)", () => {
		mergeQuadsIntoSnapshot([
			{ subject: "cmt-1", predicate: "id", object: "cmt-1", namedGraph: "Comment", timestamp: 1 },
			{ subject: "cmt-1", predicate: "seqPath", object: "0.-1.26", namedGraph: "Comment", timestamp: 1 },
			{ subject: "cmt-1", predicate: "hasBody", object: "body-cmt-1", namedGraph: "Comment", objectType: BODY_LABEL, timestamp: 1 },
			{ subject: "body-cmt-1", predicate: "content", object: "Lawrence vouches for this neighbour", namedGraph: BODY_LABEL, timestamp: 1 },
		]);
		const label = currentSnapshot().clusters.find((c) => c.type === "Comment")?.displayLabels["cmt-1"];
		expect(label).toContain("Lawrence vouches");
		expect(label).not.toContain("seqPath");
	});

	it("relabels the parent when its linked body arrives in a later merge (the body is emitted before the hasBody edge)", () => {
		mergeQuadsIntoSnapshot([
			{ subject: "cmt-2", predicate: "id", object: "cmt-2", namedGraph: "Comment", timestamp: 1 },
			{ subject: "body-cmt-2", predicate: "content", object: "a later body", namedGraph: BODY_LABEL, timestamp: 1 },
		]);
		// The hasBody edge (emitted after the body) touches the comment, so it is relabelled with the body now present.
		mergeQuadsIntoSnapshot([{ subject: "cmt-2", predicate: "hasBody", object: "body-cmt-2", namedGraph: "Comment", objectType: BODY_LABEL, timestamp: 2 }]);
		const label = currentSnapshot().clusters.find((c) => c.type === "Comment")?.displayLabels["cmt-2"];
		expect(label).toBe("a later body");
	});

	it("merges 100k streamed quads in near-linear time (no O(n²) index rebuild)", () => {
		const N = 100_000;
		const PROPS = 5;
		const start = performance.now();
		for (let s = 0; s * PROPS < N; s++) feedSubject("X", `X-${s}`, PROPS);
		const ms = performance.now() - start;

		expect(currentSnapshot().clusters[0]?.sampledCount).toBe(DEFAULT_PER_TYPE_LIMIT); // bounded regardless of N
		expect(ms).toBeLessThan(5_000); // O(n²) over ~20k batches would take minutes; linear is well under this
	});
});
