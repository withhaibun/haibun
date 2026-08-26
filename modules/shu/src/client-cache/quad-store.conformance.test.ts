// @vitest-environment jsdom
/**
 * One specification, both quad stores. A view reads the graph through `IQuadStore` and does not know whether the store
 * under it is the one in memory (a report, a test, a server without its own engine) or the page's IndexedDB. Any
 * difference between them is a difference between what a reader sees online and offline, so both answer the same cases
 * here. IndexedDB runs on `fake-indexeddb`, so the implementation a reader actually uses is covered in a unit test.
 *
 * Two parts of `IQuadStore` are deliberately not specified here. The query surface an engine answers (filtered individual
 * queries, distinct values, clustering) is delegated by the client store to the server rather than reimplemented. And an
 * individual is identified differently by design: the authoritative store requires the identity field the type declares
 * and validates the record against its schema, while the page caches a fetched record under the `@id` it was
 * dereferenced by, with no schema to validate against. Each store states that rule in its own test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import type { IQuadStore, TQuad } from "@haibun/core/lib/quad-types.js";
import { IndexedDbQuadStore } from "./quad-store.js";
import { MemoryDeviceStore, IndexedDbDeviceStore, resetDeviceStoreIdb } from "./device-store.js";

const GRAPH = "Comment";
const sorted = (quads: TQuad[]): string[] => quads.map((q) => `${q.namedGraph}|${q.subject}|${q.predicate}=${JSON.stringify(q.object)}`).sort();

const stores: Array<[string, () => IQuadStore]> = [
	["in memory", () => new QuadStore()],
	["IndexedDB", () => new IndexedDbQuadStore()],
];

for (const [name, make] of stores) {
	describe(`the quad store (${name})`, () => {
		let store: IQuadStore;
		beforeEach(async () => {
			resetDeviceStoreIdb();
			await new IndexedDbDeviceStore().clear();
			await new MemoryDeviceStore().clear();
			store = make();
			await store.clear();
		});
		afterEach(() => resetDeviceStoreIdb());

		it("reads back what it was given, by subject and by named graph", async () => {
			await store.set("c1", "content", "hello", GRAPH);
			await store.set("c1", "author", "did:example:a", GRAPH);
			expect(await store.get("c1", "content", GRAPH)).toBe("hello");
			expect(sorted(await store.query({ subject: "c1" }))).toEqual([`${GRAPH}|c1|author="did:example:a"`, `${GRAPH}|c1|content="hello"`]);
			expect(sorted(await store.query({ namedGraph: GRAPH })).length).toBe(2);
		});

		it("a fact set again replaces the fact, rather than adding a second row for it", async () => {
			await store.set("c1", "content", "first", GRAPH);
			await store.set("c1", "content", "second", GRAPH);
			expect((await store.query({ subject: "c1", predicate: "content" })).length).toBe(1);
			expect(await store.get("c1", "content", GRAPH)).toBe("second");
		});

		it("keeps named graphs apart: the same subject and predicate in two graphs are two facts", async () => {
			await store.set("x", "name", "in comments", GRAPH);
			await store.set("x", "name", "in issues", "Issue");
			expect(await store.get("x", "name", GRAPH)).toBe("in comments");
			expect(await store.get("x", "name", "Issue")).toBe("in issues");
		});

		it("reads nothing for a subject it does not hold, rather than reporting something absent", async () => {
			expect(await store.get("missing", "content", GRAPH)).toBeUndefined();
			expect(await store.query({ subject: "missing" })).toEqual([]);
		});

		it("matches a pattern on any of subject, predicate, object and named graph", async () => {
			await store.add({ subject: "a", predicate: "p", object: 1, namedGraph: GRAPH });
			await store.add({ subject: "a", predicate: "q", object: 2, namedGraph: GRAPH });
			await store.add({ subject: "b", predicate: "p", object: 1, namedGraph: "Issue" });
			expect((await store.query({ predicate: "p" })).length).toBe(2);
			expect((await store.query({ object: 1 })).length).toBe(2);
			expect((await store.query({ subject: "a", predicate: "q" })).length).toBe(1);
			expect((await store.query({ namedGraph: "Issue" })).length).toBe(1);
		});

		it("removes what a pattern names and nothing else, and clears one named graph or all of them", async () => {
			await store.add({ subject: "a", predicate: "p", object: 1, namedGraph: GRAPH });
			await store.add({ subject: "b", predicate: "p", object: 2, namedGraph: GRAPH });
			await store.add({ subject: "c", predicate: "p", object: 3, namedGraph: "Issue" });
			await store.remove({ subject: "a" });
			expect((await store.all()).length).toBe(2);
			await store.clear(GRAPH);
			expect(sorted(await store.all())).toEqual([`Issue|c|p=3`]);
			await store.clear();
			expect(await store.all()).toEqual([]);
		});

	});
}
