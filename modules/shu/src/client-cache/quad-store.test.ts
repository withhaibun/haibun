// The client IQuadStore answers every read over what this page caches, its query surface included: with no server to
// ask, a view is offered what the reader holds rather than nothing. The quad primitives are covered by the conformance
// specification both stores answer; these are the questions the site is otherwise asked.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import { IndexedDbQuadStore } from "./quad-store.js";
import { resetDeviceStoreIdb } from "./device-store.js";

describe("the questions the site answers, asked of the graph this page caches", () => {
	const access = { perTypeLimit: 10, accessLevel: "private" as AccessLevel };
	let store: IndexedDbQuadStore;
	beforeEach(async () => {
		resetDeviceStoreIdb();
		store = new IndexedDbQuadStore();
		await store.clear();
		await store.upsertIndividual("Email", { "@id": "a", folder: "INBOX", subject: "one" });
		await store.upsertIndividual("Email", { "@id": "b", folder: "Sent", subject: "two" });
		await store.upsertIndividual("Comment", { "@id": "c", content: "hello" });
	});

	it("groups what it caches by type, with each type's total", async () => {
		const clustered = await store.getClusteredQuads(access);
		expect(clustered.clusters.map((c) => c.type).sort()).toEqual(["Comment", "Email"]);
		expect(clustered.clusters.find((c) => c.type === "Email")?.totalCount).toBe(2);
		expect((await store.getClusteredQuads({ ...access, types: ["Comment"] })).clusters.map((c) => c.type)).toEqual(["Comment"]);
	});

	it("keeps a type's sample within the limit, and says how many it left out", async () => {
		const one = (await store.getClusteredQuads({ ...access, perTypeLimit: 1, types: ["Email"] })).clusters[0];
		expect(one.sampledCount).toBe(1);
		expect(one.omittedCount).toBe(1);
	});

	it("lists a type's records, narrowed by a field and windowed", async () => {
		expect((await store.queryIndividuals("Email")).length).toBe(2);
		expect(await store.queryIndividuals("Email", { folder: "Sent" })).toEqual([{ "@id": "b", "@type": "Email", folder: "Sent", subject: "two" }]);
		expect((await store.queryIndividuals<{ "@id": string }>("Email", undefined, { offset: 1, limit: 1 })).map((i) => i["@id"])).toEqual(["b"]);
	});

	it("reports the distinct values a field holds, for the dropdowns a reader filters by", async () => {
		expect(await store.distinctPropertyValues("Email", "folder")).toEqual(["INBOX", "Sent"]);
		expect(await store.distinctPropertyValues("Email", "nothing")).toEqual([]);
	});
});

describe("an individual in the page's cache", () => {
	// The page caches a record under the `@id` it was dereferenced by: that is the identity a view holds and asks again
	// with. The authoritative store instead requires the identity field the type declares, and validates the record.
	beforeEach(async () => {
		resetDeviceStoreIdb();
		await new IndexedDbQuadStore().clear();
	});

	it("caches a record by its @id, reads it back with its type, replaces it in place and deletes it", async () => {
		const store = new IndexedDbQuadStore();
		expect(await store.upsertIndividual("Comment", { "@id": "c1", content: "hello", author: "did:example:a" })).toBe("c1");
		expect(await store.getIndividual("Comment", "c1")).toMatchObject({ "@id": "c1", "@type": "Comment", content: "hello", author: "did:example:a" });
		await store.upsertIndividual("Comment", { "@id": "c1", content: "changed" });
		expect(await store.getIndividual("Comment", "c1")).toMatchObject({ content: "changed", author: "did:example:a" });
		await store.deleteIndividual("Comment", "c1");
		expect(await store.getIndividual("Comment", "c1")).toBeUndefined();
	});

	it("refuses a record with no @id rather than caching something no view can ask for again", async () => {
		await expect(new IndexedDbQuadStore().upsertIndividual("Comment", { content: "no id" })).rejects.toThrow(/@id/);
	});
});
