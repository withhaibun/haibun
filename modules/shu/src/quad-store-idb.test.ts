// The client IQuadStore is persist + deref-by-@id locally; its query surface (clustered sampling, filtered individual
// queries, distinct values) is server-side, so it delegates to an injected remote — and fails loudly, never silently
// empty, when none is wired. (The persist/deref methods are IndexedDB-backed and exercised by the e2e suites, not here.)
import { describe, it, expect, vi } from "vitest";
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import { IndexedDbQuadStore } from "./quad-store-idb.js";

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
