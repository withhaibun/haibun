import { describe, expect, it } from "vitest";
import { QuadStore } from "./quad-store.js";
import { handleStoreCall, isStoreMethod, requiredStoreCapability, STORE_READ, STORE_WRITE } from "./store-protocol.js";

describe("store protocol capability classification", () => {
	it("requires store.write for anything that changes the store and store.read otherwise", () => {
		for (const m of ["set", "add", "remove", "clear", "upsertIndividual", "deleteIndividual", "createEdge"]) expect(requiredStoreCapability(`store.${m}`)).toBe(STORE_WRITE);
		for (const m of ["get", "query", "all", "getIndividual", "queryIndividuals", "distinctPropertyValues", "getClusteredQuads"])
			expect(requiredStoreCapability(`store.${m}`)).toBe(STORE_READ);
	});

	it("recognizes exactly the wire methods", () => {
		expect(isStoreMethod("store.upsertIndividual")).toBe(true);
		expect(isStoreMethod("store.dropTables")).toBe(false);
		expect(isStoreMethod("GraphSourceStepper-getClusteredQuads")).toBe(false);
	});
});

describe("handleStoreCall", () => {
	it("round-trips an individual and envelopes results so undefined survives JSON", async () => {
		const store = new QuadStore();
		const up = await handleStoreCall(store, "store.upsertIndividual", { label: "Widget", data: { id: "w-1", name: "One" } });
		expect(up.result).toBe("w-1");
		const got = await handleStoreCall(store, "store.getIndividual", { label: "Widget", id: "w-1" });
		expect(got.result).toEqual({ id: "w-1", name: "One" });
		const missing = await handleStoreCall(store, "store.getIndividual", { label: "Widget", id: "w-2" });
		expect(missing).toEqual({ result: undefined });
	});

	it("fails fast on params that do not match the wire contract", async () => {
		const store = new QuadStore();
		await expect(handleStoreCall(store, "store.upsertIndividual", { data: {} })).rejects.toThrow();
		await expect(handleStoreCall(store, "store.getClusteredQuads", { perTypeLimit: 10 })).rejects.toThrow();
	});

	it("honours the IQuadStore createEdge contract for a store without the edge primitive (documented add fallback)", async () => {
		const store = new QuadStore();
		await handleStoreCall(store, "store.createEdge", { fromLabel: "Widget", fromId: "w-1", edgeLabel: "references", toLabel: "Widget", toId: "w-2" });
		const quads = await store.query({ subject: "w-1", predicate: "references" });
		expect(quads).toHaveLength(1);
		expect(quads[0].objectType).toBe("Widget");
	});

	it("serves clustered reads with scope passed through", async () => {
		const store = new QuadStore();
		await store.add({ subject: "w-1", predicate: "name", object: "One", namedGraph: "Widget" });
		const r = (await handleStoreCall(store, "store.getClusteredQuads", { perTypeLimit: 10, accessLevel: "private", scope: "own" })).result as { clusters: Array<{ type: string }> };
		expect(r.clusters.map((c) => c.type)).toEqual(["Widget"]);
	});
});
