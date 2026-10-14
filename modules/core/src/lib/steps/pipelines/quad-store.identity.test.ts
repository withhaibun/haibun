/**
 * A record is addressable by its identity field. A record without a value in that field is refused, since a write under
 * the literal subject "undefined" isn't read and the next such record overwrites it.
 */
import { describe, expect, it } from "vitest";
import { QuadStore, newStoreChain } from "./quad-store.js";
import { recordOf } from "../../records/pipelines/record-reads.js";
import { storeDeclaring } from "../../test/declared-types.js";

const IDENTITY_REFUSED = /is identified by its "(id|path)" field, and this record doesn't state it/;

describe("upsertIndividual identity", () => {
	it('refuses a record without a value in its identity field, rather than writing it under "undefined"', async () => {
		const store = new QuadStore(newStoreChain());
		await expect(store.upsertIndividual("Thing", { path: "src/a.ts", name: "a" })).rejects.toThrow(IDENTITY_REFUSED);
		expect(await store.query({ namedGraph: "Thing" })).toHaveLength(0);
	});

	it("refuses an empty or whitespace identity, which doesn't address a record either", async () => {
		const store = new QuadStore(newStoreChain());
		await expect(store.upsertIndividual("Thing", { id: "" })).rejects.toThrow(IDENTITY_REFUSED);
		await expect(store.upsertIndividual("Thing", { id: "   " })).rejects.toThrow(IDENTITY_REFUSED);
	});

	it("writes each record of a type it doesn't declare under its id", async () => {
		const store = new QuadStore(newStoreChain());
		await store.upsertIndividual("Thing", { id: "a", name: "first" });
		await store.upsertIndividual("Thing", { id: "b", name: "second" });
		const subjects = [...new Set((await store.query({ namedGraph: "Thing" })).map((q) => q.subject))].sort();
		expect(subjects, "two records, which an unaddressable write collapsed into one").toEqual(["a", "b"]);
	});

	it("identifies a record by the field its type's declaration states", async () => {
		const store = storeDeclaring({ File: { id: "path" } });
		await store.upsertIndividual("File", { path: "src/a.ts", name: "a" });
		expect(await recordOf(store, "File", "src/a.ts")).toBeDefined();
	});

	it("refuses a record without the field its type's declaration states, naming the field", async () => {
		const store = storeDeclaring({ File: { id: "path" } });
		await expect(store.upsertIndividual("File", { name: "a" })).rejects.toThrow(/"path"/);
	});
});
