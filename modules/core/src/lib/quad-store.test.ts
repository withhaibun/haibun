import { QuadStore } from "./quad-store.js";
import { describe, it, expect, beforeEach } from "vitest";

describe("QuadStore Contexts", () => {
	let store: QuadStore;

	beforeEach(() => {
		store = new QuadStore();
	});

	it("should store and retrieve quads with default namedGraph", () => {
		store.add({ subject: "s", predicate: "p", object: "o", namedGraph: "default" });
		const results = store.query({ subject: "s" });
		expect(results).toHaveLength(1);
		expect(results[0].namedGraph).toBe("default");
	});

	it("should store and retrieve quads with arbitrary namedGraph", () => {
		store.add({ subject: "s", predicate: "p", object: "o", namedGraph: "trust-registry" });
		const results = store.query({ namedGraph: "trust-registry" });
		expect(results).toHaveLength(1);
		expect(results[0].namedGraph).toBe("trust-registry");
	});

	it("should isolate namedGraphs", () => {
		store.add({ subject: "s", predicate: "p", object: "o1", namedGraph: "A" });
		store.add({ subject: "s", predicate: "p", object: "o2", namedGraph: "B" });

		const resultsA = store.query({ namedGraph: "A" });
		expect(resultsA).toHaveLength(1);
		expect(resultsA[0].object).toBe("o1");

		const resultsB = store.query({ namedGraph: "B" });
		expect(resultsB).toHaveLength(1);
		expect(resultsB[0].object).toBe("o2");
	});

	it("should query across namedGraphs if namedGraph not specified", () => {
		store.add({ subject: "s", predicate: "p", object: "o1", namedGraph: "A" });
		store.add({ subject: "s", predicate: "p", object: "o2", namedGraph: "B" });

		const results = store.query({ subject: "s" });
		expect(results).toHaveLength(2);
	});

	it("should clear specific namedGraph", () => {
		store.add({ subject: "s", predicate: "p", object: "o1", namedGraph: "A" });
		store.add({ subject: "s", predicate: "p", object: "o2", namedGraph: "B" });

		store.clear("A");
		expect(store.query({ namedGraph: "A" })).toHaveLength(0);
		expect(store.query({ namedGraph: "B" })).toHaveLength(1);
	});
});
