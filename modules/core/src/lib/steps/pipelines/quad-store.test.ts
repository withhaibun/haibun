import { z } from "zod";
import { QuadStore, newStoreChain } from "./quad-store.js";
import { heldRecordIri } from "../../test/declared-types.js";
import { bucketOf } from "../derivations/quad-sample.js";
import { GraphQuerySchema } from "../domains/quad-types.js";
import { readEvery } from "../../records/pipelines/record-reads.js";
import { storeDeclaring } from "../../test/declared-types.js";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { accessBound, runAuthorizedWith, runReadingAt, writeBound } from "../../domains/capability-context.js";
import { readAction, readCeilingOf, writeAction } from "../../domains/actions.js";
import { Access, type AccessLevel } from "../../domains/resources.js";
import { itemAt } from "../../domains/item-at.js";
import { COUNT_CEILING } from "../../domains/hypermedia.js";

describe("QuadStore Contexts", () => {
	let store: QuadStore;

	beforeEach(() => {
		store = new QuadStore(newStoreChain());
	});

	it("should store and retrieve quads with default namedGraph", async () => {
		await store.add({ subject: "s", predicate: "p", object: "o", namedGraph: "default" });
		const results = await store.query({ subject: "s" });
		expect(results).toHaveLength(1);
		expect(itemAt(results, 0).namedGraph).toBe("default");
	});

	it("should store and retrieve quads with arbitrary namedGraph", async () => {
		await store.add({ subject: "s", predicate: "p", object: "o", namedGraph: "trust-registry" });
		const results = await store.query({ namedGraph: "trust-registry" });
		expect(results).toHaveLength(1);
		expect(itemAt(results, 0).namedGraph).toBe("trust-registry");
	});

	it("should isolate namedGraphs", async () => {
		await store.add({ subject: "s", predicate: "p", object: "o1", namedGraph: "A" });
		await store.add({ subject: "s", predicate: "p", object: "o2", namedGraph: "B" });
		const resultsA = await store.query({ namedGraph: "A" });
		expect(resultsA).toHaveLength(1);
		expect(itemAt(resultsA, 0).object).toBe("o1");
		const resultsB = await store.query({ namedGraph: "B" });
		expect(resultsB).toHaveLength(1);
		expect(itemAt(resultsB, 0).object).toBe("o2");
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
		expect(itemAt(quads, 0).properties?.origin).toBe("var");
		expect(itemAt(quads, 0).properties?.readonly).toBe(true);
	});
});

describe("backing routing is shared along the store chain, and a registration never outlives its owner", () => {
	/** The minimal backing a routing test needs: `query` and `all` return one quad. */
	const fakeBacking = () => {
		const quad = { subject: "e1", predicate: "subject", object: "hello", namedGraph: "Letter", timestamp: 1 };
		return { backing: { query: async () => [quad], all: async () => [quad] } as unknown as import("../ports.js").IQuadStore, quad };
	};

	it("a store carried from another sees its registrations without copying, and new registrations flow both ways", async () => {
		const { backing } = fakeBacking();
		const first = new QuadStore(newStoreChain());
		await first.registerStore(backing, ["Letter"]);
		const second = new QuadStore(first.storeChain());
		first.carryNonVariableQuadsTo(second);
		expect(await second.query({ namedGraph: "Letter" })).toHaveLength(1);
		// A registration made on the LATER store is visible to the earlier one: one table, not copies.
		const { backing: other } = fakeBacking();
		await second.registerStore(other, ["Person"]);
		expect(await first.query({ namedGraph: "Person" })).toHaveLength(1);
	});

	it("a backing that refuses a record isn't registered, and the records stay where they were", async () => {
		const store = new QuadStore(newStoreChain());
		await store.set("e1", "subject", "hello", "Letter");
		const refusal = new Error("the backing's pages are unreadable");
		const refusing = { upsertIndividual: async () => Promise.reject(refusal) } as unknown as import("../ports.js").IQuadStore;
		await expect(store.registerStore(refusing, ["Letter"])).rejects.toBe(refusal);
		expect(await store.get("e1", "subject", "Letter"), "the record is read where it was written").toBe("hello");
	});

	it("unregisterStore removes the backing from every store in the chain at once", async () => {
		const { backing } = fakeBacking();
		const first = new QuadStore(newStoreChain());
		await first.registerStore(backing, ["Letter", "Body"]);
		const second = new QuadStore(first.storeChain());
		const third = new QuadStore(second.storeChain());
		second.unregisterStore(backing);
		expect(await first.all()).toHaveLength(0);
		expect(await second.query({ namedGraph: "Letter" })).toHaveLength(0);
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

	it("reads a relation its type declares to one type as an edge in a graph read, so the graph draws a record written whole", async () => {
		const store = storeDeclaring({ Step: { relations: { isPartOf: ["Step"], seenBy: ["Step", "Other"] } } });
		await store.upsertIndividual("Step", { id: "s1", isPartOf: "s0", seenBy: "s0", name: "one" });
		const { quads } = await store.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		expect(Object.fromEntries(quads.map((q) => [q.predicate, q.objectType]))).toMatchObject({ isPartOf: "Step", seenBy: undefined, name: undefined });
	});

	it("merges a peer's clusters into getClusteredQuads with per-subject site stamps intact; local subjects stay unstamped", async () => {
		const store = new QuadStore(newStoreChain());
		await store.add({ subject: "local-1", predicate: "name", object: "local-1", namedGraph: "Document" });
		store.federate(peer("did:site:remote.1", "Document", "remote-1"));
		const result = await store.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		const document = result.clusters.find((c) => c.type === "Document");
		expect([...(document?.sampledSubjects ?? [])].sort()).toEqual(["local-1", "remote-1"]);
		expect(document?.sites).toEqual({ "remote-1": "did:site:remote.1" });
	});

	it("touches only getClusteredQuads: a federated peer never appears in raw queries or all()", async () => {
		const store = new QuadStore(newStoreChain());
		store.federate(peer("did:site:remote.1", "Document", "remote-1"));
		expect(await store.query({ namedGraph: "Document" })).toHaveLength(0);
		expect(await store.all()).toHaveLength(0);
	});

	it('serves scope "own" without reading peers: the scope a federated read states, so a federation cycle cannot recurse', async () => {
		const store = new QuadStore(newStoreChain());
		await store.add({ subject: "local-1", predicate: "name", object: "local-1", namedGraph: "Document" });
		store.federate(peer("did:site:remote.1", "Document", "remote-1"));
		const own = await store.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private", scope: "own" });
		expect(own.clusters.find((c) => c.type === "Document")?.sampledSubjects).toEqual(["local-1"]);
	});

	it("refuses a second source for the same site, site principals must be unique in a federation", () => {
		const store = new QuadStore(newStoreChain());
		store.federate(peer("did:site:remote.1", "Document", "a"));
		expect(() => store.federate(peer("did:site:remote.1", "Document", "b"))).toThrow(/already federated/);
	});

	it("carries federation along the store chain by reference, and unfederate removes it everywhere", async () => {
		const store = new QuadStore(newStoreChain());
		const source = peer("did:site:remote.1", "Document", "remote-1");
		store.federate(source);
		const next = new QuadStore(store.storeChain());
		const seen = await next.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		expect(seen.clusters.find((c) => c.type === "Document")?.sampledSubjects).toEqual(["remote-1"]);
		store.unfederate(source);
		const after = await next.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		expect(after.clusters.find((c) => c.type === "Document")).toBeUndefined();
	});
});

describe("the page a store of quads returns for a graph query", () => {
	// The site's own query and a page reading its own copy of the graph both read this page, so the two never drift.
	const declared = { Letter: { filters: ["folder"] }, Note: { filters: ["generatedAtTime"] } };
	const store = storeDeclaring(declared);
	beforeAll(async () => {
		await store.upsertIndividual("Letter", { id: "a", folder: "INBOX" });
		await store.upsertIndividual("Letter", { id: "b", folder: "Sent" });
	});

	it("lists a type's records, narrowed by equality and windowed", async () => {
		expect((await store.readRecords(GraphQuerySchema.parse({ label: "Letter" }))).total).toBe(2);
		const [inbox, sent] = [
			{ "@id": heldRecordIri("Letter", "a"), "@type": "Letter", id: "a", folder: "INBOX" },
			{ "@id": heldRecordIri("Letter", "b"), "@type": "Letter", id: "b", folder: "Sent" },
		];
		expect((await store.readRecords(GraphQuerySchema.parse({ label: "Letter", filters: [{ predicate: "folder", operator: "eq", value: "Sent" }] }))).vertices).toEqual([sent]);
		expect(
			(await store.readRecords(GraphQuerySchema.parse({ label: "Letter", limit: 1, offset: 1 }))).vertices,
			"each row carries its type, and records without a time order by id",
		).toEqual([inbox]);
	});

	it("reads a range of time, which paging through a long run by time reads", async () => {
		const at = (t: string) =>
			GraphQuerySchema.parse({ label: "Note", filters: [{ predicate: "generatedAtTime", operator: "gt", value: t }], sortBy: "generatedAtTime", sortOrder: "asc" });
		const times = storeDeclaring(declared);
		await times.upsertIndividual("Note", { id: "a", generatedAtTime: "2026-01-01T00:00:00.000Z" });
		await times.upsertIndividual("Note", { id: "b", generatedAtTime: "2026-06-01T00:00:00.000Z" });
		await times.upsertIndividual("Note", { id: "c", generatedAtTime: "2026-12-01T00:00:00.000Z" });
		expect((await times.readRecords(at("2026-05-01T00:00:00.000Z"))).vertices.map((v) => v.id)).toEqual(["b", "c"]);
		const between = GraphQuerySchema.parse({
			label: "Note",
			filters: [{ predicate: "generatedAtTime", operator: "between", value: "2026-02-01T00:00:00.000Z", value2: "2026-07-01T00:00:00.000Z" }],
		});
		expect((await times.readRecords(between)).vertices.map((v) => v.id)).toEqual(["b"]);
	});

	it("windows what the conditions matched, not what the store returned before they were applied", async () => {
		const times = storeDeclaring(declared);
		for (const [id, month] of [
			["a", "01"],
			["b", "06"],
			["c", "12"],
		])
			await times.upsertIndividual("Note", { id, generatedAtTime: `2026-${month}-01T00:00:00.000Z` });
		const after = { label: "Note", filters: [{ predicate: "generatedAtTime", operator: "gt", value: "2026-05-01T00:00:00.000Z" }], sortOrder: "asc", limit: 1 };
		const page = await times.readRecords(GraphQuerySchema.parse(after));
		expect(
			page.vertices.map((v) => v.id),
			"the first of what matched",
		).toEqual(["b"]);
		expect(page.total, "and how many matched, which is what a reader is told there are").toBe(2);
	});

	it("orders what matched before windowing it, so a page of the newest is the newest of what matched", async () => {
		const times = storeDeclaring(declared);
		for (const [id, month] of [
			["b", "06"],
			["c", "12"],
			["a", "01"],
		])
			await times.upsertIndividual("Note", { id, generatedAtTime: `2026-${month}-01T00:00:00.000Z` });
		const newest = GraphQuerySchema.parse({ label: "Note", sortBy: "generatedAtTime", sortOrder: "desc", limit: 2 });
		expect((await times.readRecords(newest)).vertices.map((v) => v.id)).toEqual(["c", "b"]);
		const oldest = GraphQuerySchema.parse({ label: "Note", sortBy: "generatedAtTime", sortOrder: "asc", limit: 2 });
		expect((await times.readRecords(oldest)).vertices.map((v) => v.id)).toEqual(["a", "b"]);
	});
});

describe("which division of a span an instant falls in", () => {
	it("divides by the span, so a span that does not divide evenly still returns the buckets the read states", () => {
		// 10 units over 3 buckets: a bucket width isn't a whole number, and every instant still lands in one of the three.
		expect([0, 1, 3, 4, 6, 7, 9].map((at) => bucketOf(at, 0, 10, 3))).toEqual([0, 0, 0, 1, 1, 2, 2]);
	});

	it("puts the end of the span in the last bucket, since a bucket after it doesn't exist to hold it", () => {
		expect(bucketOf(10, 0, 10, 3)).toBe(2);
	});

	it("returns an instant outside the span isn't in a bucket", () => {
		expect(bucketOf(-1, 0, 10, 3)).toBe(-1);
		expect(bucketOf(11, 0, 10, 3)).toBe(-1);
	});

	it("puts everything in the first bucket when the span is one instant", () => {
		expect(bucketOf(5, 5, 5, 4)).toBe(0);
	});
});

describe("the level each quad a run holds is written and read at", () => {
	const [NOTICE, FACTS] = ["Notice", "facts"];
	const DECLARED: Record<string, AccessLevel> = { [NOTICE]: Access.public, [FACTS]: Access.private };
	const levels = { bound: accessBound, writeBound, declared: (label: string) => DECLARED[label] };
	const [reader, publicReader] = [[readAction(Access.private)], [readAction(Access.public)]];
	const as = <T>(held: string[], within: () => Promise<T>): Promise<T> => runAuthorizedWith(held, () => runReadingAt(readCeilingOf(held), within));
	let store: QuadStore;

	beforeEach(() => {
		store = storeDeclaring({ [NOTICE]: {} }, levels);
	});

	it("refuses a write that doesn't state a level to a graph that doesn't declare one", async () => {
		await expect(store.set("note-1", "says", "kept", "undeclared")).rejects.toThrow("a write that doesn't state a level is refused");
	});

	it("doesn't return actuality's own facts to a public reader", async () => {
		await store.set("fact-1", "says", "kept", FACTS);
		expect(await as(publicReader, () => store.query({ namedGraph: FACTS }))).toEqual([]);
		expect((await store.getClusteredQuads({ perTypeLimit: 10, accessLevel: Access.public })).quads, "nor to a read at public").toEqual([]);
		expect(await as(reader, () => store.get("fact-1", "says", FACTS)), "and to a private reader").toBe("kept");
	});

	it("writes at private a record whose level a private reader doesn't state, where its type is public, and actuality's at public", async () => {
		await as(reader, () => store.upsertIndividual(NOTICE, { id: "notice-1", text: "read privately" }));
		await store.upsertIndividual(NOTICE, { id: "notice-2", text: "actuality's" });
		const read = await as(publicReader, () => readEvery(store, { label: NOTICE }));
		expect(read.map(({ id, accessLevel }) => [id, accessLevel])).toEqual([["notice-2", Access.public]]);
	});

	it("refuses a private reader a write into a public record, and a removal from one", async () => {
		await store.upsertIndividual(NOTICE, { id: "notice-1", text: "published" });
		await expect(as(reader, () => store.set("notice-1", "text", "read privately", NOTICE))).rejects.toThrow(writeAction(Access.public));
		await expect(as(reader, () => store.remove({ subject: "notice-1", namedGraph: NOTICE }))).rejects.toThrow(writeAction(Access.public));
		expect(await store.get("notice-1", "text", NOTICE), "and the record is as it was published").toBe("published");
	});
});

describe("the distinct values of a property", () => {
	const GRAPH = "Note";
	const FIELD = "folder";
	it("counts the values to the ceiling, and states where the count stopped", async () => {
		const store = new QuadStore(newStoreChain());
		for (let n = 0; n <= COUNT_CEILING; n++) await store.add({ subject: `note-${n}`, predicate: FIELD, object: `folder-${String(n).padStart(4, "0")}`, namedGraph: GRAPH });
		const held = await store.distinctPropertyValues(GRAPH, FIELD);
		expect(held).toMatchObject({ total: COUNT_CEILING, saturated: true });
		expect(held.values).toHaveLength(COUNT_CEILING);
		for (const subject of ["note-0", "note-1"]) await store.remove({ subject, namedGraph: GRAPH });
		expect(await store.distinctPropertyValues(GRAPH, FIELD), "a count below the ceiling states every value").toMatchObject({ total: COUNT_CEILING - 1, saturated: false });
	});
});

describe("the edges a store of quads writes", () => {
	it("writes an edge its type declares, and refuses one its type doesn't declare and the vocabulary doesn't hold", async () => {
		const store = storeDeclaring({ Step: { relations: { isPartOf: ["Step"] } } });
		await store.createEdge("Step", "a", "isPartOf", "Step", "b");
		expect((await store.query({ subject: "a", predicate: "isPartOf" })).map(({ object }) => object)).toEqual(["b"]);
		await expect(store.createEdge("Step", "a", "wroteBy", "Step", "b")).rejects.toThrow("Step doesn't declare the edge wroteBy");
	});
});

describe("a typed read of one record", () => {
	const NoteSchema = z.object({ id: z.string(), text: z.string(), generatedAtTime: z.string() });
	const NOTE = { label: "Note", schema: NoteSchema };
	const store = (): QuadStore => storeDeclaring({ [NOTE.label]: { schema: NoteSchema } });

	it("returns the record as its type's schema parses it, and undefined where the store doesn't hold it", async () => {
		const notes = store();
		await notes.upsertIndividual(NOTE.label, { id: "n1", text: "a note", generatedAtTime: "2026-07-01T00:00:00.000Z" });
		const read: z.output<typeof NoteSchema> | undefined = await notes.readRecord(NOTE, "n1");
		expect(read).toEqual({ id: "n1", text: "a note", generatedAtTime: "2026-07-01T00:00:00.000Z" });
		expect(await notes.readRecord(NOTE, "n2")).toBeUndefined();
	});

	it("refuses a schema other than the one the type's declaration registers", async () => {
		await expect(store().readRecord({ label: NOTE.label, schema: NoteSchema.extend({}) }, "n1")).rejects.toThrow(
			/a typed read of Note parses with the schema Note's domain registers/,
		);
	});
});
