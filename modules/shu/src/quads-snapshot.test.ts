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
import {
	setSelectedSubject,
	subscribeSnapshot,
	getViewContext,
	mergeQuadsIntoSnapshot,
	pinSubjects,
	currentSnapshot,
	selectionFromContext,
	DEFAULT_PER_TYPE_LIMIT,
	getGraphSnapshot,
	setGraphStore,
	selectValuesFor,
	cachedGraphStore,
	queryGraph,
} from "./quads-snapshot.js";
import { aboutRecord, aboutType } from "./schemas.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { BODY_LABEL } from "@haibun/core/lib/resources.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { setSiteMetadata, type SiteMetadata } from "./rels-cache.js";
import { setConduit, LiveConduit } from "./hypermedia.js";

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

	it("two listeners registered before any change both fire on a single update, proving the listener Set is one identity, not duplicated", () => {
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

describe("mergeQuadsIntoSnapshot is bounded by the limit (the OOM fix)", () => {
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
	});

	it("caps retained quads at the per-type limit no matter how many subjects stream in", () => {
		const TYPES = 5;
		const SUBJECTS_PER_TYPE = 2_000; // far over the limit
		const PROPS = 3;
		for (let t = 0; t < TYPES; t++) for (let s = 0; s < SUBJECTS_PER_TYPE; s++) feedSubject(`T${t}`, `T${t}-${s}`, PROPS);

		const snap = currentSnapshot();
		for (const c of snap.clusters) {
			expect(c.sampledCount).toBe(DEFAULT_PER_TYPE_LIMIT); // sample capped at the limit
			expect(c.omittedCount).toBe(SUBJECTS_PER_TYPE - DEFAULT_PER_TYPE_LIMIT); // the rest counted, not retained
			expect(Object.keys(c.displayLabels).length).toBe(DEFAULT_PER_TYPE_LIMIT); // every retained subject is labelled
		}
		// ~30k subjects streamed; retained quads are bounded by limit × types × props, not total.
		expect(snap.quads.length).toBeLessThanOrEqual(DEFAULT_PER_TYPE_LIMIT * TYPES * PROPS);
	});

	it("pinned (expanded) subjects are retained even past the limit", () => {
		pinSubjects(["P-pinned"]);
		for (let s = 0; s < 500; s++) feedSubject("P", `P-${s}`, 2); // fill far past the limit
		feedSubject("P", "P-pinned", 2); // arrives after the limit is full

		const snap = currentSnapshot();
		const labels = snap.clusters.find((c) => c.type === "P")?.displayLabels ?? {};
		expect(labels["P-pinned"]).toBeDefined(); // pinned subject kept despite the limit being full
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

describe("per-scope snapshots, independent data sources over one store", () => {
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
	});

	it("a merge extends every scope that holds a cache, each notified with ITS OWN snapshot", () => {
		const sharedSeen: number[] = [];
		const scopedSeen: number[] = [];
		subscribeSnapshot((snap) => sharedSeen.push(snap?.quads.length ?? -1));
		subscribeSnapshot((snap) => scopedSeen.push(snap?.quads.length ?? -1), "class-browser");
		feedSubject("Email", "e-1", 2); // creates the default scope's cache; the scoped cache doesn't exist yet
		expect(sharedSeen.at(-1)).toBe(2);
		expect(scopedSeen.length).toBe(0); // no cache in that scope yet → no data notification for it
	});

	it("pinning and reading are scoped: subjects pinned in one scope never appear in another's snapshot", () => {
		feedSubject("Email", "e-1", 1);
		pinSubjects(["e-1"]); // default scope
		expect(currentSnapshot().quads.length).toBe(1);
		expect(currentSnapshot("class-browser").quads.length).toBe(0); // the scoped source is untouched
	});

	it("a selection change is global: listeners of every scope receive it", () => {
		const scopes: string[] = [];
		subscribeSnapshot((_s, ctx) => scopes.push(`shared:${ctx.selectedSubject}`));
		subscribeSnapshot((_s, ctx) => scopes.push(`browser:${ctx.selectedSubject}`), "class-browser");
		setSelectedSubject("Issuer", "Issuer");
		expect(scopes).toContain("shared:Issuer");
		expect(scopes).toContain("browser:Issuer");
	});
});

describe("selectionFromContext, only a context that ADDRESSES selection moves it", () => {
	it("a subject pattern selects", () => {
		expect(selectionFromContext({ patterns: [aboutRecord("Issuer", "did:web:one")] })).toEqual({ action: "select", subject: "did:web:one", label: "Issuer" });
	});
	it("an explicitly empty patterns array clears (the empty-space click)", () => {
		expect(selectionFromContext({ patterns: [] })).toEqual({ action: "clear" });
	});
	it("a query context (label/predicate/object, no subject) leaves the selection untouched", () => {
		expect(selectionFromContext({ patterns: [aboutType("Body")] }), "a type says nothing about which record is selected").toEqual({ action: "none" });
		expect(selectionFromContext({})).toEqual({ action: "none" });
	});
});

describe("the graph a page caches, with no server to ask", () => {
	// A page that carries its graph clusters it for itself: the sample, its totals and its `+N more` nodes are what the
	// site's own answer would have been, rather than a captured copy of that answer riding in the page.
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
		setConduit(new LiveConduit(""));
		globalThis.fetch = () => Promise.reject(new TypeError("this page has no server"));
	});

	it("holds the store on the page, so a view in another bundle reads the graph the app installed", () => {
		const store = new QuadStore();
		setGraphStore(store);
		// A second bundle has its own copy of this module's bindings and reaches the store through the page, as here.
		expect((globalThis as unknown as Record<string, { store: unknown }>)["__SHU_CACHED_GRAPH_STORE__"].store).toBe(store);
		expect(cachedGraphStore()).toBe(store);
	});

	it("groups what it caches by type, as the site would have", async () => {
		const store = new QuadStore();
		await store.setMany([
			{ subject: "c1", predicate: "content", object: "one", namedGraph: "Comment", timestamp: 1 },
			{ subject: "c2", predicate: "content", object: "two", namedGraph: "Comment", timestamp: 2 },
		]);
		setGraphStore(store);
		const snapshot = await getGraphSnapshot({ perTypeLimit: 10, scope: "carried" });
		expect(snapshot.quads.length, "the graph it caches").toBe(2);
		expect(Array.isArray(snapshot.clusters), "clustered by the store, not by a captured response").toBe(true);
	});

	it("reports that the graph is not available when it caches none and no server answers", async () => {
		setGraphStore(new QuadStore());
		await expect(getGraphSnapshot({ perTypeLimit: 10, scope: "empty" })).rejects.toThrow();
	});
});

describe("the dropdown values a reader is offered, with no server to ask", () => {
	// The site derives them from the fields a type declares as context; a page with no server derives them the same way
	// over the graph it caches, so the reader is offered the same fields narrowed to the values there.
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
		setConduit(new LiveConduit(""));
		globalThis.fetch = () => Promise.reject(new TypeError("this page has no server"));
		setSiteMetadata({ types: ["Email"], rels: { Email: { folder: LinkRelations.CONTEXT.rel, subject: "name" } }, edgeRanges: {} } as unknown as SiteMetadata);
	});

	it("offers the distinct values its context fields hold, and no field the type does not declare as one", async () => {
		const store = new QuadStore();
		await store.setMany([
			{ subject: "a", predicate: "folder", object: "INBOX", namedGraph: "Email", timestamp: 1 },
			{ subject: "b", predicate: "folder", object: "Sent", namedGraph: "Email", timestamp: 2 },
			{ subject: "b", predicate: "subject", object: "two", namedGraph: "Email", timestamp: 3 },
		]);
		setGraphStore(store);
		expect(await selectValuesFor("Email")).toEqual({ folder: ["INBOX", "Sent"] });
	});

	it("offers no dropdown for a declared type that has no context field, and reports the failure for a type the site never declared", async () => {
		setSiteMetadata({ types: ["Email", "Note"], rels: { Email: { folder: LinkRelations.CONTEXT.rel }, Note: { body: "hasBody" } }, edgeRanges: {} } as unknown as SiteMetadata);
		setGraphStore(new QuadStore());
		expect(await selectValuesFor("Note")).toEqual({});
		await expect(selectValuesFor("NeverDeclared")).rejects.toThrow();
	});
});

describe("the rows a graph query names, with no server to ask", () => {
	// The page answers with the same function the site's own inherent query uses, over the graph it caches.
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
		setConduit(new LiveConduit(""));
		globalThis.fetch = () => Promise.reject(new TypeError("this page has no server"));
		setSiteMetadata({ types: ["Email"], rels: { Email: { folder: LinkRelations.CONTEXT.rel } }, edgeRanges: {} } as unknown as SiteMetadata);
	});

	it("lists what it caches of the type, narrowed by the same filters", async () => {
		const store = new QuadStore();
		await store.setMany([
			{ subject: "a", predicate: "messageId", object: "a", namedGraph: "Email", timestamp: 1 },
			{ subject: "a", predicate: "folder", object: "INBOX", namedGraph: "Email", timestamp: 1 },
			{ subject: "b", predicate: "messageId", object: "b", namedGraph: "Email", timestamp: 2 },
			{ subject: "b", predicate: "folder", object: "Sent", namedGraph: "Email", timestamp: 2 },
		]);
		setGraphStore(store);
		expect((await queryGraph({ label: "Email" })).total).toBe(2);
		// The row carries the type's own identity field, which is how a reader opens it from the list.
		expect((await queryGraph({ label: "Email", filters: [{ predicate: "folder", operator: "eq", value: "Sent" }] })).vertices).toEqual([{ messageId: "b", folder: "Sent" }]);
	});

	it("reports the failure for a type the site never declared, rather than an empty list", async () => {
		setGraphStore(new QuadStore());
		await expect(queryGraph({ label: "NeverDeclared" })).rejects.toThrow();
	});
});
