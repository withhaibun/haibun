// @vitest-environment jsdom
/**
 * One specification, both device stores. The client cache reads through the `DeviceStore` interface and does not know
 * which implementation is under it: the browser's IndexedDB on a served origin, memory in a report and in tests. Any
 * difference between them is a difference between what a reader sees online and offline, so both answer the same cases
 * here rather than each carrying its own. IndexedDB runs on `fake-indexeddb`, so the implementation a reader actually
 * uses is covered in a unit test rather than only in a browser.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbDeviceStore, MemoryDeviceStore, resetDeviceStoreIdb, storedEventKey, type DeviceStore, type TStoredEvent } from "./device-store.js";

const RUN = "r1";
const OTHER = "r2";
/** An event as the server stamps it: its run, its time, and its index at each level it counts toward. */
const ev = (i: number, over: Partial<TStoredEvent> = {}): TStoredEvent => ({ id: `[0.${i}]`, timestamp: 1000 + i, kind: "log", level: "info", run: RUN, idx: { debug: i, trace: i, log: i, info: i }, ...over });

const stores: Array<[string, () => DeviceStore]> = [
	["memory", () => new MemoryDeviceStore()],
	["IndexedDB", () => new IndexedDbDeviceStore()],
];

for (const [name, make] of stores) {
	describe(`the device store (${name})`, () => {
		let store: DeviceStore;
		beforeEach(async () => {
			resetDeviceStoreIdb();
			store = make();
			await store.clear();
		});
		afterEach(async () => {
			await store.clear();
			resetDeviceStoreIdb();
		});

		it("caches nothing until events are put, and reports an empty summary", async () => {
			expect(await store.pageAt(RUN, "info", 0, 5)).toEqual([]);
			expect(await store.rowsAt(RUN, "info", 0, 3)).toEqual([undefined, undefined, undefined]);
			expect(await store.extent(RUN, "info")).toBeUndefined();
			expect(await store.lastRun()).toBeUndefined();
			expect(await store.registry()).toBeUndefined();
			expect((await store.summary()).runs.flatMap((r) => r.levels)).toEqual([]);
		});

		it("serves a page it caches completely, and nothing at all for a page with a row missing", async () => {
			await store.putMany([ev(0), ev(1), ev(2), ev(4)]);
			expect((await store.pageAt(RUN, "info", 0, 3)).map((e) => e.id), "the whole page, in index order").toEqual(["[0.0]", "[0.1]", "[0.2]"]);
			expect(await store.pageAt(RUN, "info", 2, 5), "row 3 is not cached: none of the page is served").toEqual([]);
		});

		it("reports what it caches of a page by index, a hole for each row it lacks", async () => {
			await store.putMany([ev(0), ev(2)]);
			expect((await store.rowsAt(RUN, "info", 0, 3)).map((e) => e?.id)).toEqual(["[0.0]", undefined, "[0.2]"]);
		});

		it("keeps each run apart, by run and by level", async () => {
			await store.putMany([ev(0), ev(1), ev(0, { run: OTHER, id: "[9.0]" })]);
			expect((await store.pageAt(OTHER, "info", 0, 1)).map((e) => e.id)).toEqual(["[9.0]"]);
			expect((await store.pageAt(RUN, "info", 0, 2)).map((e) => e.id)).toEqual(["[0.0]", "[0.1]"]);
			// An event that counts at debug alone is not a row at info.
			await store.putMany([ev(5, { level: "debug", id: "[0.5]", idx: { debug: 5 } })]);
			expect(await store.pageAt(RUN, "info", 5, 6)).toEqual([]);
			expect((await store.pageAt(RUN, "debug", 5, 6)).map((e) => e.id)).toEqual(["[0.5]"]);
		});

		it("is idempotent: the same event put twice is one row", async () => {
			await store.putMany([ev(0), ev(1)]);
			await store.putMany([ev(0), ev(1)]);
			expect((await store.pageAt(RUN, "info", 0, 2)).length).toBe(2);
			const info = (await store.summary()).runs.find((r) => r.run === RUN)?.levels.find((l) => l.level === "info");
			expect(info?.stored).toBe(2);
		});

		it("tells two events of one instant apart by the index the server stamped", async () => {
			const start = ev(7, { id: "[0.7]", stage: "start", idx: { debug: 7, trace: 7, log: 7, info: 7 } });
			const end = { ...start, stage: "end", idx: { debug: 8, trace: 8, log: 8, info: 8 } };
			expect(storedEventKey(start)).not.toBe(storedEventKey(end));
			await store.putMany([start, end]);
			expect((await store.pageAt(RUN, "info", 7, 9)).map((e) => e.stage)).toEqual(["start", "end"]);
		});

		it("keeps each run's extent per level, and the run last seen", async () => {
			await store.setExtent(RUN, "info", { total: 42, first: 1000, last: 1041 });
			await store.setExtent(OTHER, "info", { total: 7 });
			await store.setLastRun(RUN);
			expect(await store.extent(RUN, "info")).toEqual({ total: 42, first: 1000, last: 1041 });
			expect(await store.extent(OTHER, "info")).toEqual({ total: 7 });
			expect(await store.extent(RUN, "warn")).toBeUndefined();
			expect(await store.lastRun()).toBe(RUN);
		});

		it("keeps the server's registry with the time it was cached", async () => {
			const before = Date.now();
			await store.setRegistry({ steps: [], domains: {}, concerns: { persisted: {} } });
			const cached = await store.registry();
			expect(cached?.response).toEqual({ steps: [], domains: {}, concerns: { persisted: {} } });
			expect(cached?.savedAt).toBeGreaterThanOrEqual(before);
			expect((await store.summary()).registry?.savedAt).toBe(cached?.savedAt);
		});

		it("summarizes what it caches: per run and level, how many events and the extent", async () => {
			await store.putMany([ev(0), ev(1), ev(2)]);
			await store.setExtent(RUN, "info", { total: 3, first: 1000 });
			await store.setLastRun(RUN);
			const summary = await store.summary();
			expect(summary.lastRun).toBe(RUN);
			const info = summary.runs.find((r) => r.run === RUN)?.levels.find((l) => l.level === "info");
			expect(info).toEqual({ level: "info", stored: 3, extent: { total: 3, first: 1000 } });
		});

		it("keeps the newest runs and the one being read, and forgets the rest", async () => {
			for (const [run, at] of [["old", 1000], ["older", 500], ["newest", 9000]] as const) {
				await store.putMany([ev(0, { run, id: `[${run}]` })]);
				await store.setExtent(run, "info", { total: 1, first: at, last: at });
			}
			const forgotten = await store.cullRuns(1, "older");
			expect(forgotten, "everything but the newest and the one being read").toEqual(["old"]);
			const left = (await store.summary()).runs.map((r) => r.run).sort();
			expect(left).toEqual(["newest", "older"]);
			expect(await store.pageAt("old", "info", 0, 1), "its events are gone").toEqual([]);
			expect(await store.extent("old", "info"), "and its extent").toBeUndefined();
			expect(await store.pageAt("older", "info", 0, 1), "the run being read is kept whatever its age").not.toEqual([]);
		});

		it("forgets nothing when it caches no more runs than are kept", async () => {
			await store.putMany([ev(0)]);
			await store.setExtent(RUN, "info", { total: 1, first: 1000, last: 1000 });
			expect(await store.cullRuns(5)).toEqual([]);
			expect((await store.summary()).runs.map((r) => r.run)).toEqual([RUN]);
		});

		it("forgets everything on clear", async () => {
			await store.putMany([ev(0)]);
			await store.setExtent(RUN, "info", { total: 1 });
			await store.setLastRun(RUN);
			await store.setRegistry({ steps: [] });
			await store.clear();
			expect(await store.pageAt(RUN, "info", 0, 1)).toEqual([]);
			expect(await store.extent(RUN, "info")).toBeUndefined();
			expect(await store.lastRun()).toBeUndefined();
			expect(await store.registry()).toBeUndefined();
		});
	});
}

describe("the device's database across versions", () => {
	// A version that adds a store or an index must keep what a reader already cached: deleting the stores would drop every
	// run on the device for a change that only extends the shape. And a page holding an earlier version must not be the
	// reason another page waits.
	const forgetDatabase = (): Promise<void> =>
		new Promise((resolve) => {
			const req = indexedDB.deleteDatabase("shu-client-cache");
			req.onsuccess = () => resolve();
			req.onerror = () => resolve();
			req.onblocked = () => resolve();
		});
	beforeEach(async () => {
		resetDeviceStoreIdb();
		await forgetDatabase(); // this case starts from a database an earlier version created
	});
	afterEach(async () => {
		resetDeviceStoreIdb();
		await forgetDatabase();
	});

	it("keeps what an earlier version cached, and creates what the new shape adds", async () => {
		// A database as an earlier version left it: the events store alone, with one event in it.
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open("shu-client-cache", 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
				const events = db.createObjectStore("events", { keyPath: "__key" });
				events.createIndex("by-run-idx-info", ["__run", "idx.info"], { unique: false });
			};
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction("events", "readwrite");
				tx.objectStore("events").put({ __key: "k1", __run: RUN, id: "[0.0]", timestamp: 1000, kind: "log", level: "info", run: RUN, idx: { info: 0 } });
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
			req.onerror = () => reject(req.error);
		});
		const store = new IndexedDbDeviceStore();
		expect((await store.pageAt(RUN, "info", 0, 1)).map((e) => e.id), "what the earlier version cached is still there").toEqual(["[0.0]"]);
		await store.setRegistry({ steps: [] });
		expect((await store.registry())?.response, "and the stores the new shape adds work").toEqual({ steps: [] });
	});
});
