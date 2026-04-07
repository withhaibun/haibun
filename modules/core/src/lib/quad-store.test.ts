import { QuadStore } from "./quad-store.js";
import { describe, it, expect, beforeEach } from "vitest";

describe("QuadStore Contexts", () => {
	let store: QuadStore;

	beforeEach(() => {
		store = new QuadStore();
	});

	it("should store and retrieve quads with default namedGraph", async () => {
		await store.add({ subject: "s", predicate: "p", object: "o", namedGraph: "default" });
		const results = await store.query({ subject: "s" });
		expect(results).toHaveLength(1);
		expect(results[0].namedGraph).toBe("default");
	});

	it("should store and retrieve quads with arbitrary namedGraph", async () => {
		await store.add({ subject: "s", predicate: "p", object: "o", namedGraph: "trust-registry" });
		const results = await store.query({ namedGraph: "trust-registry" });
		expect(results).toHaveLength(1);
		expect(results[0].namedGraph).toBe("trust-registry");
	});

	it("should isolate namedGraphs", async () => {
		await store.add({ subject: "s", predicate: "p", object: "o1", namedGraph: "A" });
		await store.add({ subject: "s", predicate: "p", object: "o2", namedGraph: "B" });
		const resultsA = await store.query({ namedGraph: "A" });
		expect(resultsA).toHaveLength(1);
		expect(resultsA[0].object).toBe("o1");
		const resultsB = await store.query({ namedGraph: "B" });
		expect(resultsB).toHaveLength(1);
		expect(resultsB[0].object).toBe("o2");
	});

	it("should query across namedGraphs if namedGraph not specified", async () => {
		await store.add({ subject: "s", predicate: "p", object: "o1", namedGraph: "A" });
		await store.add({ subject: "s", predicate: "p", object: "o2", namedGraph: "B" });
		const results = await store.query({ subject: "s" });
		expect(results).toHaveLength(2);
	});

	it("should clear specific namedGraph", async () => {
		await store.add({ subject: "s", predicate: "p", object: "o1", namedGraph: "A" });
		await store.add({ subject: "s", predicate: "p", object: "o2", namedGraph: "B" });
		await store.clear("A");
		expect(await store.query({ namedGraph: "A" })).toHaveLength(0);
		expect(await store.query({ namedGraph: "B" })).toHaveLength(1);
	});

	it("should set and get values", async () => {
		await store.set("x", "string", "hello", "variables");
		expect(await store.get("x", "string")).toBe("hello");
	});

	it("should upsert on set", async () => {
		await store.set("x", "string", "first", "variables");
		await store.set("x", "string", "second", "variables");
		expect(await store.get("x", "string")).toBe("second");
		expect(await store.query({ subject: "x", namedGraph: "variables" })).toHaveLength(1);
	});

	it("should store properties on set", async () => {
		await store.set("x", "string", "hello", "variables", { origin: "var", readonly: true });
		const quads = await store.query({ subject: "x", namedGraph: "variables" });
		expect(quads[0].properties?.origin).toBe("var");
		expect(quads[0].properties?.readonly).toBe(true);
	});
});
