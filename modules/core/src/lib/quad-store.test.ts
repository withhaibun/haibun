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

describe("backing routing is shared along the store chain, and a registration never outlives its owner", () => {
	/** The minimal backing a routing test needs: answers `query`/`all` with one quad. */
	const fakeBacking = () => {
		const quad = { subject: "e1", predicate: "subject", object: "hello", namedGraph: "Email", timestamp: 1 };
		return { backing: { query: async () => [quad], all: async () => [quad] } as unknown as import("./quad-types.js").IQuadStore, quad };
	};

	it("a store carried from another sees its registrations without copying, and new registrations flow both ways", async () => {
		const { backing } = fakeBacking();
		const first = new QuadStore();
		await first.registerStore(backing, ["Email"]);
		const second = new QuadStore(first.backingRouting());
		first.carryNonVariableQuadsTo(second);
		expect(await second.query({ namedGraph: "Email" })).toHaveLength(1);
		// A registration made on the LATER store is visible to the earlier one — one table, not copies.
		const { backing: other } = fakeBacking();
		await second.registerStore(other, ["Person"]);
		expect(await first.query({ namedGraph: "Person" })).toHaveLength(1);
	});

	it("unregisterStore removes the backing from every store in the chain at once", async () => {
		const { backing } = fakeBacking();
		const first = new QuadStore();
		await first.registerStore(backing, ["Email", "Body"]);
		const second = new QuadStore(first.backingRouting());
		const third = new QuadStore(second.backingRouting());
		second.unregisterStore(backing);
		expect(await first.all()).toHaveLength(0);
		expect(await second.query({ namedGraph: "Email" })).toHaveLength(0);
		expect(await third.query({ namedGraph: "Body" })).toHaveLength(0);
	});
});

describe("federated clustered reads (reads-first federation)", () => {
	const peer = (site: string, type: string, subject: string) => ({
		site,
		getClusteredQuads: () =>
			Promise.resolve({
				quads: [{ subject, predicate: "name", object: subject, namedGraph: type, timestamp: 1 }],
				clusters: [{ type, totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: [subject], displayLabels: { [subject]: subject }, sites: { [subject]: site } }],
				site,
			}),
	});

	it("merges a peer's clusters into getClusteredQuads with per-subject site stamps intact; local subjects stay unstamped", async () => {
		const store = new QuadStore();
		await store.add({ subject: "local-1", predicate: "name", object: "local-1", namedGraph: "Email" });
		store.federate(peer("did:site:imap.1", "Email", "remote-1"));
		const result = await store.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		const email = result.clusters.find((c) => c.type === "Email");
		expect([...(email?.sampledSubjects ?? [])].sort()).toEqual(["local-1", "remote-1"]);
		expect(email?.sites).toEqual({ "remote-1": "did:site:imap.1" });
	});

	it("touches only getClusteredQuads — a federated peer never appears in raw queries or all()", async () => {
		const store = new QuadStore();
		store.federate(peer("did:site:imap.1", "Email", "remote-1"));
		expect(await store.query({ namedGraph: "Email" })).toHaveLength(0);
		expect(await store.all()).toHaveLength(0);
	});

	it('serves scope "own" without consulting peers — what a federated read asks for, so a federation cycle cannot recurse', async () => {
		const store = new QuadStore();
		await store.add({ subject: "local-1", predicate: "name", object: "local-1", namedGraph: "Email" });
		store.federate(peer("did:site:imap.1", "Email", "remote-1"));
		const own = await store.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private", scope: "own" });
		expect(own.clusters.find((c) => c.type === "Email")?.sampledSubjects).toEqual(["local-1"]);
	});

	it("refuses a second source for the same site — site principals must be unique in a federation", () => {
		const store = new QuadStore();
		store.federate(peer("did:site:imap.1", "Email", "a"));
		expect(() => store.federate(peer("did:site:imap.1", "Email", "b"))).toThrow(/already registered/);
	});

	it("carries federation along the store chain by reference, and unfederate removes it everywhere", async () => {
		const store = new QuadStore();
		const source = peer("did:site:imap.1", "Email", "remote-1");
		store.federate(source);
		const next = new QuadStore(store.backingRouting(), store.backingFederated());
		const seen = await next.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		expect(seen.clusters.find((c) => c.type === "Email")?.sampledSubjects).toEqual(["remote-1"]);
		store.unfederate(source);
		const after = await next.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		expect(after.clusters.find((c) => c.type === "Email")).toBeUndefined();
	});
});
