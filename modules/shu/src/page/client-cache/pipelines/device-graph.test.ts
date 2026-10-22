// @vitest-environment jsdom
// The client IQuadStore serves every read over what this page caches, its query surface included: without a server, a
// view is offered what the reader holds rather than an empty result. The conformance specification of both stores
// covers the quad primitives; these are the reads the site otherwise serves.
import { hydrate, serveThePage } from "../../../test/setup.js";
import { hydrateFromDom } from "../../controllers/hydration-controller.js";
import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { Access, type AccessLevel } from "@haibun/core/lib/domains/resources.js";
import { DeviceGraph } from "./device-graph.js";
import { deviceQuads, heldDatabases, servedDatabase } from "../root.js";
import { IndexedDbQuads } from "../adapters/quad-store.js";
import { deviceDatabase } from "../adapters/device-store.js";
import { CACHE_SHAPE, DEVICE_STORES, META_KEY } from "../ports.js";
import { GraphQuerySchema } from "@haibun/core/lib/quad-types.js";
import { equalTo, readEvery, recordOf } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { declaredTypes } from "@haibun/core/lib/test/declared-types.js";

/** The types these tests write, declared so the device store reads their records. */
const declared = () => declaredTypes({ Email: { filters: ["folder"] }, Comment: {}, SeqPath: {} });

/** The device's graph of the actuality the page reads, reading the types these tests declare. */
const servedGraph = (): DeviceGraph => new DeviceGraph(deviceQuads(servedDatabase()), declared);

// The page is served, so its device store is the database of the actuality the page reads.
beforeAll(serveThePage);

describe("the reads the site serves, made of the graph this page caches", () => {
	const access = { perTypeLimit: 10, accessLevel: "private" as AccessLevel };
	let store: DeviceGraph;
	beforeEach(async () => {
		store = servedGraph();
		await store.clear();
		await store.upsertIndividual("Email", { "@id": "a", folder: "INBOX", subject: "one", accessLevel: Access.public });
		await store.upsertIndividual("Email", { "@id": "b", folder: "Sent", subject: "two", accessLevel: Access.public });
		await store.upsertIndividual("Comment", { "@id": "c", content: "hello", accessLevel: Access.public });
	});

	it("returns a read at the level it was made at, not everything it happens to hold", async () => {
		// A page holds what it was served, which may have been read at a wider level than a later read's.
		await store.upsertIndividual("Email", { "@id": "p", accessLevel: "private", folder: "INBOX" });
		await store.upsertIndividual("Email", { "@id": "o", accessLevel: "public", folder: "INBOX" });
		const publicly = await store.getClusteredQuads({ perTypeLimit: 10, types: ["Email"], accessLevel: "public" as AccessLevel });
		expect([...new Set(publicly.quads.map((q) => q.subject))].sort(), "the record stating a level beyond the read is not in it").toEqual(["a", "b", "o"]);
		const privately = await store.getClusteredQuads({ perTypeLimit: 10, types: ["Email"], accessLevel: "private" as AccessLevel });
		expect([...new Set(privately.quads.map((q) => q.subject))].sort(), "and a read that may see it does").toEqual(["a", "b", "o", "p"]);
	});

	it("returns what points at an individual by its id, and a value that is not an id the same way", async () => {
		// An id is looked up; a value that cannot be a key is matched after the widest read. Both return the same quads.
		await store.upsertIndividual("Email", { "@id": "e", inReplyTo: "a", flagged: true, tags: ["x", "y"] });
		await store.upsertIndividual("Comment", { "@id": "d", inReplyTo: "a" });
		expect((await store.query({ object: "a" })).map((q) => `${q.namedGraph}:${q.subject}`).sort()).toEqual(["Comment:d", "Email:e"]);
		expect((await store.query({ object: true })).map((q) => q.subject)).toEqual(["e"]);
		expect((await store.query({ object: ["x", "y"], namedGraph: "Email" })).map((q) => q.predicate)).toEqual(["tags"]);
		expect((await store.query({ object: "nothing points here" })).length).toBe(0);
	});

	it("groups what it caches by type, with each type's total", async () => {
		const clustered = await store.getClusteredQuads(access);
		expect(clustered.clusters.map((c) => c.type).sort()).toEqual(["Comment", "Email"]);
		expect(clustered.clusters.find((c) => c.type === "Email")?.totalCount).toBe(2);
		expect((await store.getClusteredQuads({ ...access, types: ["Comment"] })).clusters.map((c) => c.type)).toEqual(["Comment"]);
	});

	it("keeps a type's sample within the limit, and reports how many it left out", async () => {
		const one = itemAt((await store.getClusteredQuads({ ...access, perTypeLimit: 1, types: ["Email"] })).clusters, 0);
		expect(one.sampledCount).toBe(1);
		expect(one.omittedCount).toBe(1);
	});

	it("lists a type's records, narrowed by a field and windowed", async () => {
		expect((await readEvery(store, { label: "Email" })).length).toBe(2);
		expect(await readEvery(store, { label: "Email", filters: equalTo({ folder: "Sent" }) })).toEqual([
			{ "@id": "b", "@type": "Email", folder: "Sent", subject: "two", accessLevel: Access.public },
		]);
		const window = await store.readRecords(GraphQuerySchema.parse({ label: "Email", offset: 1, limit: 1 }));
		expect(
			window.vertices.map((i) => i["@id"]),
			"records without a time order by id, newest first",
		).toEqual(["a"]);
	});

	it("reports the distinct values a field holds, for the dropdowns a reader filters by", async () => {
		expect(await store.distinctPropertyValues("Email", "folder")).toEqual({ values: ["INBOX", "Sent"], total: 2, saturated: false });
		expect(await store.distinctPropertyValues("Email", "nothing")).toEqual({ values: [], total: 0, saturated: false });
	});
});

describe("an individual in the page's cache", () => {
	// The page caches a record under the `@id` that dereferenced it: that is the identity a view holds and reads again. The authoritative store instead requires the identity field the type declares, and validates the record.
	beforeEach(async () => {
		await servedGraph().clear();
	});

	it("caches a record by its @id, reads it back with its type, replaces it in place and deletes it", async () => {
		const store = servedGraph();
		expect(await store.upsertIndividual("Comment", { "@id": "c1", content: "hello", author: "did:example:a" })).toBe("c1");
		expect(await recordOf(store, "Comment", "c1")).toMatchObject({ "@id": "c1", "@type": "Comment", content: "hello", author: "did:example:a" });
		await store.upsertIndividual("Comment", { "@id": "c1", content: "changed" });
		expect(await recordOf(store, "Comment", "c1")).toMatchObject({ content: "changed", author: "did:example:a" });
		await store.deleteIndividual("Comment", "c1");
		expect(await recordOf(store, "Comment", "c1")).toBeUndefined();
	});

	it("does not write again a fact the device holds as it is, and writes one that changed", async () => {
		const store = servedGraph();
		const fact = (object: unknown, timestamp: number) => ({ subject: "c1", predicate: "content", object, namedGraph: "Comment", timestamp });
		await store.setMany([fact({ text: "hello" }, 1)]);
		await store.setMany([fact({ text: "hello" }, 2)]);
		expect(await store.query({ subject: "c1" }), "held as it was, so not written again").toMatchObject([{ object: { text: "hello" }, timestamp: 1 }]);
		await store.setMany([fact({ text: "changed" }, 3)]);
		expect(await store.query({ subject: "c1" }), "a changed fact replaces what was held").toMatchObject([{ object: { text: "changed" }, timestamp: 3 }]);
	});

	it("refuses a record that doesn't state an identity, since a view can't read it again", async () => {
		await expect(servedGraph().upsertIndividual("Comment", { content: "no id" })).rejects.toThrow(/doesn't state an identity/);
	});

	it("holds a record by the identity it states, whether that is its @id or the id it records", async () => {
		const store = servedGraph();
		expect(await store.upsertIndividual("Comment", { "@id": "c1", content: "served" }), "what a site serves names itself @id").toBe("c1");
		expect(await store.upsertIndividual("SeqPath", { id: "1700000000000-1.0.1", stepText: "a step" }), "what an actuality records names itself id").toBe("1700000000000-1.0.1");
	});
});

describe("the records of another actuality", () => {
	it("aren't read by a page served for another actuality, and the device holds each actuality's records apart", async () => {
		serveThePage();
		const first = servedGraph();
		await first.upsertIndividual("SeqPath", { "@id": "s1", stepText: "a step of the first actuality" });
		hydrate({ actualityId: crypto.randomUUID() });
		hydrateFromDom();
		const second = servedGraph();
		expect(await recordOf(second, "SeqPath", "s1"), "the other actuality's record").toBeUndefined();
		expect(await recordOf(first, "SeqPath", "s1"), "still held in its own").toMatchObject({ stepText: "a step of the first actuality" });
		await second.upsertIndividual("SeqPath", { "@id": "s2", stepText: "a step of the second actuality" });
		expect(await heldDatabases()).toEqual(expect.arrayContaining([first.database, second.database]));
	});
});

describe("a clustered read of named types", () => {
	it("reads each named type through the type index, rather than every quad the device holds", async () => {
		const store = servedGraph();
		await store.clear();
		await store.upsertIndividual("Email", { "@id": "a", folder: "INBOX", accessLevel: Access.public });
		await store.upsertIndividual("Comment", { "@id": "c", content: "hello", accessLevel: Access.public });
		const everyQuad = vi.spyOn(IDBObjectStore.prototype, "getAll");
		const clustered = await store.getClusteredQuads({ perTypeLimit: 10, types: ["Comment"], accessLevel: Access.public });
		expect(clustered.clusters.map((c) => c.type)).toEqual(["Comment"]);
		expect(
			everyQuad.mock.calls.filter((args) => args.length === 0 || args[0] === undefined),
			"a read of every quad without a key",
		).toEqual([]);
		everyQuad.mockRestore();
	});
});

/** A database's graph, new for each test, that holds at most `bound` quads. */
const boundedQuads = (bound: number) =>
	new IndexedDbQuads(deviceDatabase(`bound-${crypto.randomUUID()}`, { opened: new Map(), report: { warn: () => undefined, failure: () => undefined } }), bound);
/** The shape of a database an earlier build wrote. */
const EARLIER_SHAPE = "an earlier shape";
const fact = (n: number) => ({ subject: `s${n}`, predicate: "content", object: `text ${n}`, namedGraph: "Comment", timestamp: 1000 + n });

describe("the bound of a database's graph", () => {
	it("drops the oldest quads past its bound, and states how full it is and how many it dropped", async () => {
		const quads = boundedQuads(5);
		await quads.setMany([1, 2, 3, 4, 5, 6, 7, 8].map(fact));
		expect(await quads.saturation()).toEqual({ held: 5, bound: 5, dropped: 3 });
		expect((await quads.all()).map((q) => q.subject).sort(), "the oldest three are the ones dropped").toEqual(["s4", "s5", "s6", "s7", "s8"]);
		await quads.setMany([fact(9)]);
		expect(await quads.saturation(), "the count dropped adds up across writes").toEqual({ held: 5, bound: 5, dropped: 4 });
	});
});

describe("the transactions of a database's graph", () => {
	it("issue each request in the task that opens the transaction, so a busy page doesn't leave a transaction idle", async () => {
		// Chromium aborts a transaction its page leaves idle for 60 s while another waits on it: a transaction that awaits a
		// result before its next request waits on the page, and a page busy that long had its transaction aborted. A request
		// issued after the transaction delivered a result is such a wait.
		const waits: string[] = [];
		const answered = new WeakSet<IDBTransaction>();
		const watched = (proto: IDBObjectStore | IDBIndex, methods: string[]) => {
			for (const method of methods) {
				const issue = Reflect.get(proto, method) as (...args: unknown[]) => IDBRequest;
				vi.spyOn(proto as unknown as Record<string, (...args: unknown[]) => IDBRequest>, method).mockImplementation(function (this: IDBObjectStore | IDBIndex, ...args: unknown[]) {
					const tx = this instanceof IDBIndex ? this.objectStore.transaction : this.transaction;
					if (answered.has(tx)) waits.push(`${tx.mode} ${method}`);
					const request = issue.apply(this, args);
					request.addEventListener("success", () => answered.add(tx));
					return request;
				});
			}
		};
		watched(IDBObjectStore.prototype, ["add", "put", "delete", "clear", "get", "getAll", "getAllKeys", "count", "openCursor"]);
		watched(IDBIndex.prototype, ["get", "getAll", "getAllKeys", "count", "openCursor"]);
		const quads = boundedQuads(3);
		await quads.setMany([1, 2, 3].map(fact));
		await quads.set("s1", "content", "text 1, again", "Comment");
		await quads.add(fact(4));
		await quads.remove({ subject: "s2" });
		await quads.clear("Comment");
		const saturation = await quads.saturation();
		vi.restoreAllMocks();
		expect(waits).toEqual([]);
		expect(saturation, "the writes held and dropped as they state").toEqual({ held: 0, bound: 3, dropped: 1 });
	});
});

describe("the writes of a database's graph", () => {
	it("run one at a time, and the facts that arrive before a write starts are held in it, so each fact is held once", async () => {
		// The browser runs every database of an origin through one queue. A page that wrote each batch of facts as it arrived
		// held a fact two writes upserted at once twice, and queued writes that a page opened again after a reload waited behind.
		const quads = boundedQuads(1000);
		expect(await quads.saturation(), "the database opens before the writes are watched").toMatchObject({ held: 0 });
		let open = 0;
		let most = 0;
		let written = 0;
		const begin = IDBDatabase.prototype.transaction;
		vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
			const tx = begin.apply(this, args);
			if (tx.mode === "readwrite" && tx.objectStoreNames.contains(DEVICE_STORES.QUADS)) {
				written++;
				most = Math.max(most, ++open);
				const ended = () => open--;
				tx.addEventListener("complete", ended);
				tx.addEventListener("abort", ended);
			}
			return tx;
		});
		const versions = Array.from({ length: 30 }, (_, n) => n);
		await Promise.all(versions.map((n) => quads.setMany([{ ...fact(1), object: `text 1, version ${n}` }, fact(100 + n)])));
		const afterOne = written;
		await Promise.all([quads.setMany([fact(2)]), quads.set("s3", "content", "text 3", "Comment"), quads.add(fact(4)), quads.setMany([fact(5)])]);
		vi.restoreAllMocks();
		expect(most, "a write of the page at a time").toBe(1);
		expect(afterOne, "the facts that arrived before the first write started are held in it").toBe(1);
		expect(await quads.query({ subject: "s1" }), "and a fact upserted by every one of them is held once, as the last set it").toEqual([
			expect.objectContaining({ object: "text 1, version 29" }),
		]);
		expect((await quads.all()).length).toBe(versions.length + 5);
	});
});

describe("a database written under another shape", () => {
	it("opens cleared, so the first read after it opens doesn't return what the other shape held", async () => {
		const name = `shape-${crypto.randomUUID()}`;
		const warned: string[] = [];
		const opened = () => deviceDatabase(name, { opened: new Map(), report: { warn: (message) => warned.push(message), failure: () => undefined } });
		await new IndexedDbQuads(opened(), 10).setMany([fact(1)]);
		await opened().within("readwrite", [DEVICE_STORES.META], (tx) => tx.objectStore(DEVICE_STORES.META).put(EARLIER_SHAPE, META_KEY.SHAPE));
		expect(await new IndexedDbQuads(opened(), 10).all()).toEqual([]);
		expect(warned).toEqual([`what this device holds was written as ${EARLIER_SHAPE}; this build reads ${CACHE_SHAPE}, so it is cleared`]);
	});
});
