/**
 * An individual must be addressable.
 *
 * upsertIndividual keyed on `String(validated[idField])`, so a record with no value in its identity field was written
 * under the literal subject "undefined": unreachable by getIndividual, and silently overwritten by the next such
 * record. The guard below it never fired, because "undefined" is a truthy string.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { QuadStore } from "./quad-store.js";

describe("upsertIndividual identity", () => {
	it('refuses a record with no value in its identity field, rather than writing it under "undefined"', async () => {
		const store = new QuadStore();
		await expect(store.upsertIndividual("Thing", { path: "src/a.ts", name: "a" })).rejects.toThrow(/Missing identity field/);
		expect(await store.query({ namedGraph: "Thing" })).toHaveLength(0);
	});

	it("refuses an empty or whitespace identity, which cannot address anything either", async () => {
		const store = new QuadStore();
		await expect(store.upsertIndividual("Thing", { id: "" })).rejects.toThrow(/Missing identity field/);
		await expect(store.upsertIndividual("Thing", { id: "   " })).rejects.toThrow(/Missing identity field/);
	});

	it("still writes a record that has an id, which is the conventional identity field", async () => {
		const store = new QuadStore();
		await store.upsertIndividual("Thing", { id: "a", name: "first" });
		await store.upsertIndividual("Thing", { id: "b", name: "second" });
		const subjects = [...new Set((await store.query({ namedGraph: "Thing" })).map((q) => q.subject))].sort();
		// Two distinct records, where the unaddressable form silently collapsed them into one.
		expect(subjects).toEqual(["a", "b"]);
	});

	it("uses the registered identity field when a label declares one", async () => {
		const store = new QuadStore();
		store.registerIndividualType("File", z.object({ path: z.string(), name: z.string() }), "path");
		await store.upsertIndividual("File", { path: "src/a.ts", name: "a" });
		expect(await store.getIndividual("File", "src/a.ts")).toBeDefined();
	});

	it("refuses a record missing the registered identity field, naming the field it wanted", async () => {
		const store = new QuadStore();
		store.registerIndividualType("File", z.object({ path: z.string().optional(), name: z.string() }), "path");
		await expect(store.upsertIndividual("File", { name: "a" })).rejects.toThrow(/"path"/);
	});
});
