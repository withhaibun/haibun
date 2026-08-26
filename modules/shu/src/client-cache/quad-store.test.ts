// The client IQuadStore is persist + deref-by-@id locally; its query surface (clustered sampling, filtered individual
// queries, distinct values) is server-side, so it delegates to an injected remote — and fails loudly, never silently
// empty, when none is wired. (The persist/deref methods are IndexedDB-backed and exercised by the e2e suites, not here.)
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import { IndexedDbQuadStore } from "./quad-store.js";
import { resetDeviceStoreIdb } from "./device-store.js";

describe("IndexedDbQuadStore query surface (server-delegated)", () => {
	it("delegates getClusteredQuads / queryIndividuals / distinctPropertyValues to the injected remote", async () => {
		const remote = {
			getClusteredQuads: vi.fn().mockResolvedValue({ quads: [], clusters: [] }),
			queryIndividuals: vi.fn().mockResolvedValue([{ "@id": "x" }]),
			distinctPropertyValues: vi.fn().mockResolvedValue(["a", "b"]),
		};
		const store = new IndexedDbQuadStore(remote);
		const opts = { perTypeLimit: 10, accessLevel: "private" as AccessLevel };
		await store.getClusteredQuads(opts);
		await store.queryIndividuals("Email", { from: "x" });
		await store.distinctPropertyValues("Email", "from");
		expect(remote.getClusteredQuads).toHaveBeenCalledWith(opts);
		expect(remote.queryIndividuals).toHaveBeenCalledWith("Email", { from: "x" }, undefined);
		expect(remote.distinctPropertyValues).toHaveBeenCalledWith("Email", "from");
	});

	it("throws (never returns silently empty) when a query method is called with no remote wired", async () => {
		const store = new IndexedDbQuadStore();
		await expect(store.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" as AccessLevel })).rejects.toThrow(/not a query engine/);
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
