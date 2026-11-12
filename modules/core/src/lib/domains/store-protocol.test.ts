import { describe, expect, it } from "vitest";
import { heldRecordIri } from "../test/declared-types.js";
import { QuadStore, newStoreChain } from "../steps/pipelines/quad-store.js";
import { handleStoreCall, isStoreMethod, requiredStoreCapability, STORE_READ, STORE_WRITE } from "./store-protocol.js";
import { itemAt } from "./item-at.js";
import { GraphQueryResultSchema } from "../steps/domains/quad-types.js";
import { storeDeclaring, TEST_LEVELS } from "../test/declared-types.js";
import { referenceTo } from "../records/domains/unit.js";

describe("store protocol capability classification", () => {
	it("requires store.write for anything that changes the store and store.read otherwise", () => {
		for (const m of ["create", "update", "merge", "remove", "clear"]) expect(requiredStoreCapability(`store.${m}`)).toBe(STORE_WRITE);
		for (const m of ["get", "query", "all", "readRecords", "distinctPropertyValues", "getClusteredQuads"]) expect(requiredStoreCapability(`store.${m}`)).toBe(STORE_READ);
	});

	it("recognizes exactly the wire methods", () => {
		expect(isStoreMethod("store.merge")).toBe(true);
		expect(isStoreMethod("store.write"), "a write states its verb").toBe(false);
		expect(isStoreMethod("store.dropTables")).toBe(false);
		expect(isStoreMethod("GraphSourceStepper-getClusteredQuads")).toBe(false);
	});
});

describe("handleStoreCall", () => {
	it("round-trips an individual and envelopes results so undefined survives JSON", async () => {
		const store = storeDeclaring({ Widget: {} });
		const written = await handleStoreCall(store, "store.create", { node: { "@type": "Widget", id: "w-1", name: "One" } });
		expect(written.result, "a write outside a step doesn't list the records it wrote").toEqual({ value: "w-1", written: [], refused: [] });
		const got = await handleStoreCall(store, "store.readRecords", { query: { label: "Widget", named: ["w-1"], limit: 1 } });
		expect(GraphQueryResultSchema.parse(got.result).vertices).toEqual([{ "@id": heldRecordIri("Widget", "w-1"), "@type": "Widget", id: "w-1", name: "One" }]);
		const missing = await handleStoreCall(store, "store.get", { subject: "w-2", predicate: "name", namedGraph: "Widget" });
		expect(missing).toEqual({ result: undefined });
	});

	it("fails fast on params that do not match the wire contract", async () => {
		const store = new QuadStore(newStoreChain());
		await expect(handleStoreCall(store, "store.create", { node: { id: "w-1" } })).rejects.toThrow();
		await expect(handleStoreCall(store, "store.getClusteredQuads", { perTypeLimit: 10 })).rejects.toThrow();
	});

	it("writes a unit's edge, which a read returns with its target's type", async () => {
		const store = new QuadStore(newStoreChain());
		await handleStoreCall(store, "store.merge", { node: { "@type": "Widget", "@id": "w-1", isPartOf: referenceTo("Widget", "w-2") } });
		const quads = await store.query({ subject: "w-1", predicate: "isPartOf" });
		expect(quads).toHaveLength(1);
		expect(itemAt(quads, 0).objectType).toBe("Widget");
	});

	it("checks a write against the writes of the caller's step, returns each record it wrote, and returns the refusal of a write outside them", async () => {
		const store = storeDeclaring({ Widget: {} }, TEST_LEVELS);
		const writes = { step: "Widgets-make", products: [], changes: [{ persistedAs: "Widget", key: "name" }] };
		expect((await handleStoreCall(store, "store.merge", { node: { "@type": "Widget", id: "w-1", name: "One" }, writes })).result).toEqual({
			value: "w-1",
			written: [{ label: "Widget", id: "w-1" }],
			refused: [],
		});
		const refused = await handleStoreCall(store, "store.merge", { node: { "@type": "Widget", id: "w-1", colour: "red" }, writes });
		expect(refused.result).toEqual({ refusal: { outsideContract: { step: "Widgets-make", outside: ["Widget.colour"] } }, written: [], refused: ["Widget.colour"] });
		expect(await store.get("w-1", "colour", "Widget")).toBeUndefined();
	});

	it("serves clustered reads with scope passed through", async () => {
		const store = new QuadStore(newStoreChain());
		await store.merge({ "@type": "Widget", "@id": "w-1", name: "One" });
		const r = (await handleStoreCall(store, "store.getClusteredQuads", { perTypeLimit: 10, accessLevel: "private", scope: "own" })).result as { clusters: Array<{ type: string }> };
		expect(r.clusters.map((c) => c.type)).toEqual(["Widget"]);
	});
});
