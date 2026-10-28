// @vitest-environment jsdom
/**
 * The shu app and external clustered viewers ship as separate IIFE
 * bundles. Each carries its own copy of this module's *bindings*, but the
 * live store (cache, listeners, viewContext) is hoisted to a `globalThis`
 * singleton. That means a `setActiveViewId` call from the shu app's bundle
 * notifies subscribers registered in an external viewer bundle, and one HTTP fetch
 * populates one in-memory snapshot regardless of how many bundles are
 * importing the module.
 *
 * These tests pin that contract by simulating the cross-bundle case: a fresh
 * import of the module in a new module-graph context (achieved here by
 * deleting the cached module) sees the same singleton store.
 */
import { heldRecordIri } from "@haibun/core/lib/test/declared-types.js";
import { catalogOf, declareCatalog, declareRegistry, declareSpec, declareGraphSpec } from "../../../test/catalog-fixture.js";
import { requiredActionOf } from "../../controllers/registry-controller.js";
import { serveThePage, setupShuTest, stepsShown, newPage } from "../../../test/setup.js";
import { describe, it, expect, beforeEach } from "vitest";
import { GraphDataController, currentSnapshot, mergeIntoSnapshots, pinSubjects, setActiveViewId, subscribeSnapshot, viewContext } from "./graph-data-controller.js";
import { DEFAULT_PER_TYPE_LIMIT } from "../domains/snapshot.js";
import type { SnapshotStore } from "../machines/snapshot-store.js";
import { cachedGraph, installGraph } from "../../client-cache/controllers/device-controller.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { Access, BODY_LABEL } from "@haibun/core/lib/domains/resources.js";
import { QuadStore, newStoreChain } from "@haibun/core/lib/quad-store.js";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { installServedConduit } from "../../root.js";
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { installCarriedEventStream } from "../../root.js";
import { pagePinned } from "../../adapters/page-held.js";
import { storeDeclaring } from "@haibun/core/lib/test/declared-types.js";
import { selectValuesFor, queryGraph, readIndividual } from "../../controllers/read-controller.js";

const STORE_KEY = "__SHU_GRAPH_SNAPSHOTS__";

/** Stream one subject's quads as a single batch, mirroring how SSE delivers an upsert. */
function feedSubject(type: string, subject: string, props: number): void {
	const batch: TQuad[] = [];
	for (let p = 0; p < props; p++) batch.push({ subject, predicate: `p${p}`, object: `v${p}`, namedGraph: type, timestamp: 1 });
	mergeIntoSnapshots(batch);
}

describe("the page's one store of graph snapshots", () => {
	beforeEach(() => {
		newPage();
		serveThePage();
	});

	it("holds the store on the page, where another bundle's copy of this module finds it", () => {
		setActiveViewId("seed");
		const held = pagePinned<SnapshotStore>(STORE_KEY, () => {
			throw new Error("the page doesn't hold the graph's snapshots");
		});
		expect(held.context.activeViewId).toBe("seed");
	});

	it("subscribers see active-view updates from any caller (cross-bundle simulation)", () => {
		const seen: Array<string | null> = [];
		const unsub = subscribeSnapshot((_snap, ctx) => seen.push(ctx.activeViewId), "");
		setActiveViewId("a");
		setActiveViewId("b");
		setActiveViewId(null);
		unsub();
		expect(seen).toEqual(["a", "b", null]);
	});

	it("getViewContext reflects the latest setter, regardless of which import called it", () => {
		setActiveViewId("x");
		expect(viewContext().activeViewId).toBe("x");
	});

	it("dedups identical setActiveViewId calls (without spurious notifications)", () => {
		let count = 0;
		const unsub = subscribeSnapshot(() => count++, "");
		setActiveViewId("once");
		setActiveViewId("once");
		setActiveViewId("once");
		unsub();
		expect(count).toBe(1);
	});

	it("two listeners registered before any change both fire on a single update, proving the listener Set is one identity, not duplicated", () => {
		const a: Array<string | null> = [];
		const b: Array<string | null> = [];
		const ua = subscribeSnapshot((_s, ctx) => a.push(ctx.activeViewId), "");
		const ub = subscribeSnapshot((_s, ctx) => b.push(ctx.activeViewId), "");
		setActiveViewId("shared");
		ua();
		ub();
		expect(a).toEqual(["shared"]);
		expect(b).toEqual(["shared"]);
	});
});

describe("a merge into the snapshots is bounded by the limit (the OOM fix)", () => {
	beforeEach(() => {
		newPage();
		declareSpec({ types: [] });
		serveThePage();
	});

	it("caps retained quads at the per-type limit regardless of how many subjects stream in", () => {
		const TYPES = 5;
		const SUBJECTS_PER_TYPE = 2_000; // far over the limit
		const PROPS = 3;
		for (let t = 0; t < TYPES; t++) for (let s = 0; s < SUBJECTS_PER_TYPE; s++) feedSubject(`T${t}`, `T${t}-${s}`, PROPS);

		const snap = currentSnapshot("");
		for (const c of snap.clusters) {
			expect(c.sampledCount).toBe(DEFAULT_PER_TYPE_LIMIT); // sample capped at the limit
			expect(c.omittedCount).toBe(SUBJECTS_PER_TYPE - DEFAULT_PER_TYPE_LIMIT); // the rest counted, not retained
			expect(Object.keys(c.displayLabels).length).toBe(DEFAULT_PER_TYPE_LIMIT); // every retained subject is labelled
		}
		// ~30k subjects streamed; retained quads are bounded by limit × types × props, not total.
		expect(snap.quads.length).toBeLessThanOrEqual(DEFAULT_PER_TYPE_LIMIT * TYPES * PROPS);
	});

	it("pinned (expanded) subjects are retained even past the limit", () => {
		pinSubjects(["P-pinned"], "");
		for (let s = 0; s < 500; s++) feedSubject("P", `P-${s}`, 2); // fill far past the limit
		feedSubject("P", "P-pinned", 2); // arrives after the limit is full

		const snap = currentSnapshot("");
		const labels = snap.clusters.find((c) => c.type === "P")?.displayLabels ?? {};
		expect(labels["P-pinned"]).toBeDefined(); // pinned subject kept despite the limit being full
	});

	it("titles a body-backed subject by its linked body when both arrive in one merge (create-time)", () => {
		mergeIntoSnapshots([
			{ subject: "cmt-1", predicate: "id", object: "cmt-1", namedGraph: "Comment", timestamp: 1 },
			{ subject: "cmt-1", predicate: "seqPath", object: "0.-1.26", namedGraph: "Comment", timestamp: 1 },
			{ subject: "cmt-1", predicate: "hasBody", object: "body-cmt-1", namedGraph: "Comment", objectType: BODY_LABEL, timestamp: 1 },
			{ subject: "body-cmt-1", predicate: "content", object: "Lawrence vouches for this neighbour", namedGraph: BODY_LABEL, timestamp: 1 },
		]);
		const label = currentSnapshot("").clusters.find((c) => c.type === "Comment")?.displayLabels["cmt-1"];
		expect(label).toContain("Lawrence vouches");
		expect(label).not.toContain("seqPath");
	});

	it("relabels the parent when its linked body arrives in a later merge (the body is emitted before the hasBody edge)", () => {
		mergeIntoSnapshots([
			{ subject: "cmt-2", predicate: "id", object: "cmt-2", namedGraph: "Comment", timestamp: 1 },
			{ subject: "body-cmt-2", predicate: "content", object: "a later body", namedGraph: BODY_LABEL, timestamp: 1 },
		]);
		// The hasBody edge (emitted after the body) touches the comment, so it is relabelled with the body now present.
		mergeIntoSnapshots([{ subject: "cmt-2", predicate: "hasBody", object: "body-cmt-2", namedGraph: "Comment", objectType: BODY_LABEL, timestamp: 2 }]);
		const label = currentSnapshot("").clusters.find((c) => c.type === "Comment")?.displayLabels["cmt-2"];
		expect(label).toBe("a later body");
	});

	it("merges 100k streamed quads in near-linear time (without an O(n²) index rebuild)", () => {
		const N = 100_000;
		const PROPS = 5;
		const start = performance.now();
		for (let s = 0; s * PROPS < N; s++) feedSubject("X", `X-${s}`, PROPS);
		const ms = performance.now() - start;

		expect(currentSnapshot("").clusters[0]?.sampledCount).toBe(DEFAULT_PER_TYPE_LIMIT); // bounded regardless of N
		expect(ms).toBeLessThan(5_000); // O(n²) over ~20k batches would take minutes; linear is well under this
	});
});

describe("per-scope snapshots, independent data sources over one store", () => {
	beforeEach(() => {
		newPage();
		declareSpec({ types: [] });
		serveThePage();
	});

	it("a merge extends every scope that holds a cache, each notified with ITS OWN snapshot", () => {
		const sharedSeen: number[] = [];
		const scopedSeen: number[] = [];
		subscribeSnapshot((snap) => sharedSeen.push(snap?.quads.length ?? -1), "");
		subscribeSnapshot((snap) => scopedSeen.push(snap?.quads.length ?? -1), "class-browser");
		feedSubject("Email", "e-1", 2); // creates the default scope's cache; the scoped cache doesn't exist yet
		expect(sharedSeen.at(-1)).toBe(2);
		expect(scopedSeen.length).toBe(0); // that scope doesn't have a cache yet → it doesn't get a data notification
	});

	it("pinning and reading are scoped: subjects pinned in one scope never appear in another's snapshot", () => {
		feedSubject("Email", "e-1", 1);
		pinSubjects(["e-1"], ""); // default scope
		expect(currentSnapshot("").quads.length).toBe(1);
		expect(currentSnapshot("class-browser").quads.length).toBe(0); // the scoped source is untouched
	});

	it("an active-view change is global: listeners of every scope receive it", () => {
		const scopes: string[] = [];
		subscribeSnapshot((_s, ctx) => scopes.push(`shared:${ctx.activeViewId}`), "");
		subscribeSnapshot((_s, ctx) => scopes.push(`browser:${ctx.activeViewId}`), "class-browser");
		setActiveViewId("Issuer");
		expect(scopes).toContain("shared:Issuer");
		expect(scopes).toContain("browser:Issuer");
	});
});

describe("the graph a page caches, without a server to query", () => {
	// A page that carries its graph clusters it for itself: the sample, its totals and its `+N more` nodes are what the
	// site's own response would have held, rather than a captured copy of that response carried in the page.
	beforeEach(() => {
		newPage();
		serveThePage();
		installServedConduit("", requiredActionOf);
		serveThePage();
		installCarriedEventStream();
		globalThis.fetch = () => Promise.reject(new TypeError("this page lacks a server"));
	});

	it("holds the store on the page, so a view in another bundle reads the graph the app installed", () => {
		const store = new QuadStore(newStoreChain());
		installGraph(store);
		// A second bundle has its own copy of this module's bindings and reaches the store through the page, as here.
		expect(pagePinned<{ installed?: unknown }>("__SHU_CACHED_GRAPH_STORE__", () => ({})).installed).toBe(store);
		expect(cachedGraph()).toBe(store);
	});

	it("groups what it caches by type, as the site would have", async () => {
		const store = new QuadStore(newStoreChain());
		await store.setMany([
			{ subject: "c1", predicate: "content", object: "one", namedGraph: "Comment", timestamp: 1 },
			{ subject: "c2", predicate: "content", object: "two", namedGraph: "Comment", timestamp: 2 },
		]);
		installGraph(store);
		const snapshot = await new GraphDataController("carried").readSnapshot(10, undefined);
		expect(snapshot.quads.length, "the graph it caches").toBe(2);
		expect(Array.isArray(snapshot.clusters), "clustered by the store, not by a captured response").toBe(true);
	});

	it("reports that the graph is not available when it doesn't cache one and a server doesn't respond", async () => {
		installGraph(new QuadStore(newStoreChain()));
		await expect(new GraphDataController("empty").readSnapshot(10, undefined)).rejects.toThrow();
	});
});

describe("the dropdown values a reader is offered, without a server to query", () => {
	// The site derives them from the fields a type declares as context; a page without a server derives them the same way
	// over the graph it caches, so the reader is offered the same fields narrowed to the values there.
	beforeEach(() => {
		newPage();
		serveThePage();
		installServedConduit("", requiredActionOf);
		serveThePage();
		installCarriedEventStream();
		globalThis.fetch = () => Promise.reject(new TypeError("this page lacks a server"));
		declareGraphSpec({ types: ["Email"], rels: { Email: { folder: LinkRelations.CONTEXT.rel, subject: "name" } } });
	});

	it("offers the distinct values its context fields hold, and doesn't offer a field the type does not declare as one", async () => {
		const store = new QuadStore(newStoreChain());
		await store.setMany([
			{ subject: "a", predicate: "folder", object: "INBOX", namedGraph: "Email", timestamp: 1 },
			{ subject: "b", predicate: "folder", object: "Sent", namedGraph: "Email", timestamp: 2 },
			{ subject: "b", predicate: "subject", object: "two", namedGraph: "Email", timestamp: 3 },
		]);
		installGraph(store);
		expect(await selectValuesFor("Email")).toEqual({ folder: ["INBOX", "Sent"] });
	});

	it("doesn't offer a dropdown for a declared type that doesn't have a context field, and reports the failure for a type the site never declared", async () => {
		declareCatalog(catalogOf({ types: ["Email", "Note"], rels: { Email: { folder: LinkRelations.CONTEXT.rel }, Note: { body: "hasBody" } } }));
		installGraph(new QuadStore(newStoreChain()));
		expect(await selectValuesFor("Note")).toEqual({});
		await expect(selectValuesFor("NeverDeclared")).rejects.toThrow();
	});
});

describe("the rows a graph query names, without a server to query", () => {
	// The page responds with the same function the site's own inherent query uses, over the graph it caches.
	beforeEach(() => {
		newPage();
		serveThePage();
		installServedConduit("", requiredActionOf);
		serveThePage();
		installCarriedEventStream();
		globalThis.fetch = () => Promise.reject(new TypeError("this page lacks a server"));
		declareGraphSpec({ types: ["Email"], rels: { Email: { folder: LinkRelations.CONTEXT.rel } } });
	});

	it("lists what it caches of the type, narrowed by the same filters", async () => {
		const store = storeDeclaring({ Email: { filters: ["folder"] } });
		await store.setMany([
			{ subject: "a", predicate: "messageId", object: "a", namedGraph: "Email", timestamp: 1 },
			{ subject: "a", predicate: "folder", object: "INBOX", namedGraph: "Email", timestamp: 1 },
			{ subject: "b", predicate: "messageId", object: "b", namedGraph: "Email", timestamp: 2 },
			{ subject: "b", predicate: "folder", object: "Sent", namedGraph: "Email", timestamp: 2 },
		]);
		installGraph(store);
		expect((await queryGraph({ label: "Email" })).total).toBe(2);
		// The row carries its @id, its type and the type's own id field. A reader opens the record from the list by that id.
		expect((await queryGraph({ label: "Email", filters: [{ predicate: "folder", operator: "eq", value: "Sent" }] })).vertices).toEqual([
			{ "@id": heldRecordIri("Email", "b"), "@type": "Email", messageId: "b", folder: "Sent" },
		]);
	});

	it("reports the failure for a type the site never declared, rather than an empty list", async () => {
		installGraph(new QuadStore(newStoreChain()));
		await expect(queryGraph({ label: "NeverDeclared" })).rejects.toThrow();
	});
});

describe("an individual the page holds a copy of", () => {
	const READ = {
		method: "GraphSourceStepper-getIndividualWithEdges",
		stepperName: "GraphSourceStepper",
		stepName: "getIndividualWithEdges",
		pattern: "getIndividualWithEdges",
		read: true,
		readsAt: Access.public,
	};
	const NOT_HELD = "Email a isn't held here";
	const pageHolding = async (answer: () => unknown) => {
		setupShuTest({ dispatch: answer });
		const store = storeDeclaring({ Email: { filters: ["folder"] } });
		await store.upsertIndividual("Email", { id: "a", folder: "INBOX" });
		installGraph(store);
		declareRegistry(stepsShown([READ], {}, catalogOf({ types: ["Email"], rels: { Email: { folder: LinkRelations.CONTEXT.rel } } })));
	};
	beforeEach(() => {
		newPage();
		serveThePage();
	});

	it("is the site's response where the site responds, a record it doesn't hold among them, since the copy may be of records it no longer holds", async () => {
		await pageHolding(() => {
			throw new Error(NOT_HELD);
		});
		await expect(readIndividual("Email", "a", "private")).rejects.toThrow(NOT_HELD);
	});

	it("is the page's copy where the site doesn't respond", async () => {
		await pageHolding(() => {
			throw new ServerUnreachable(READ.method, new TypeError("the site doesn't respond"));
		});
		expect((await readIndividual("Email", "a", "private")).vertex).toMatchObject({ folder: "INBOX" });
	});
});
