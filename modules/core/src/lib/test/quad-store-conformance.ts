/**
 * One specification, every quad store. A view reads the graph through `IQuadStore` and does not know which store is
 * under it: the one in memory (a report, a test, a server with no engine of its own), the page's IndexedDB, or a
 * consumer's graph engine. A difference between them is a difference in what a reader sees, so each answers these
 * cases rather than carrying a suite of its own. Exported from core because the contract is core's; a consumer brings
 * its own store and the types it registers, and is held to the same rule.
 *
 * Two parts of `IQuadStore` are deliberately not specified here. The query surface an engine answers (filtered
 * individual queries, distinct values, clustering) is covered where each store's own reading of it matters. And an
 * individual is identified differently by design: an authoritative store requires the identity field the type declares
 * and validates the record, while a page caches what it dereferenced under its `@id`. Each store states that rule in
 * its own test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { IQuadStore, TQuad } from "../quad-types.js";

/** The two types a store under test registers: the cases keep facts apart by naming two of them. */
export type TConformanceGraphs = { first: string; second: string };

/** What a store says of itself, where stores differ by design rather than by defect. */
export type TStoreNature = {
	/** False for an authoritative store that keeps what it holds: asking it to discard is not something it does. */
	discards?: boolean;
};

const sorted = (quads: TQuad[]): string[] => quads.map((q) => `${q.namedGraph}|${q.subject}|${q.predicate}=${JSON.stringify(q.object)}`).sort();

/**
 * Run the specification against one store. `make` returns a store ready to read and write; `graphs` names the two
 * types the cases use, since a store with a schema only holds types it was told about. `prepare` runs before each case
 * for a store that needs its own setup, and `done` after.
 */
export function describeQuadStore(
	name: string,
	make: () => IQuadStore | Promise<IQuadStore>,
	graphs: TConformanceGraphs,
	hooks: { prepare?: () => Promise<void> | void; done?: () => Promise<void> | void; nature?: TStoreNature } = {},
): void {
	const { first: GRAPH, second: OTHER } = graphs;
	const discards = hooks.nature?.discards !== false;
	describe(`the quad store (${name})`, () => {
		let store: IQuadStore;
		beforeEach(async () => {
			await hooks.prepare?.();
			store = await make();
			if (discards) await store.clear();
			return async () => {
				await hooks.done?.();
			};
		});

		it("reads back what it was given, by subject and by named graph", async () => {
			await store.set("c1", "content", "hello", GRAPH);
			await store.set("c1", "author", "did:example:a", GRAPH);
			expect(await store.get("c1", "content", GRAPH)).toBe("hello");
			// What else the record holds is the type's business: a store with a schema holds the fields that type declares,
			// and one without holds only what was written. Both hold the facts that were set, which is what is read here.
			expect(sorted(await store.query({ subject: "c1", namedGraph: GRAPH }))).toEqual(expect.arrayContaining([`${GRAPH}|c1|author="did:example:a"`, `${GRAPH}|c1|content="hello"`]));
			expect((await store.query({ namedGraph: GRAPH, predicate: "content" })).length).toBe(1);
		});

		it("a fact set again replaces the fact, rather than adding a second row for it", async () => {
			await store.set("c1", "content", "first", GRAPH);
			await store.set("c1", "content", "second", GRAPH);
			expect((await store.query({ subject: "c1", predicate: "content", namedGraph: GRAPH })).length).toBe(1);
			expect(await store.get("c1", "content", GRAPH)).toBe("second");
		});

		it("keeps named graphs apart: the same subject and predicate in two graphs are two facts", async () => {
			await store.set("x", "content", "in the first", GRAPH);
			await store.set("x", "content", "in the second", OTHER);
			expect(await store.get("x", "content", GRAPH)).toBe("in the first");
			expect(await store.get("x", "content", OTHER)).toBe("in the second");
		});

		it("reads nothing for a subject it does not hold, rather than reporting something absent", async () => {
			expect(await store.get("missing", "content", GRAPH)).toBeUndefined();
			expect(await store.query({ subject: "missing", namedGraph: GRAPH })).toEqual([]);
		});

		it("matches a pattern on any of subject, predicate, object and named graph", async () => {
			await store.set("a", "content", "one", GRAPH);
			await store.set("a", "author", "did:example:a", GRAPH);
			await store.set("b", "content", "one", OTHER);
			expect((await store.query({ predicate: "content" })).length).toBe(2);
			expect((await store.query({ object: "one" })).length).toBe(2);
			expect((await store.query({ subject: "a", predicate: "author" })).length).toBe(1);
			expect((await store.query({ namedGraph: OTHER, predicate: "content" })).length).toBe(1);
		});

		it("removes what a pattern names, and nothing else", async () => {
			await store.set("a", "content", "one", GRAPH);
			await store.set("b", "content", "two", GRAPH);
			await store.set("c", "content", "three", OTHER);
			await store.remove({ subject: "a", namedGraph: GRAPH });
			expect(await store.get("a", "content", GRAPH), "what was named is gone").toBeUndefined();
			expect(await store.get("b", "content", GRAPH), "and what was not is untouched").toBe("two");
			expect(await store.get("c", "content", OTHER)).toBe("three");
		});

		it.runIf(discards)("discards one named graph, or everything it holds", async () => {
			await store.set("a", "content", "one", GRAPH);
			await store.set("c", "content", "three", OTHER);
			await store.clear(GRAPH);
			expect(await store.get("a", "content", GRAPH), "the graph it was asked to discard").toBeUndefined();
			expect(await store.get("c", "content", OTHER), "and no other").toBe("three");
			await store.clear();
			expect(await store.all()).toEqual([]);
		});
	});
}
