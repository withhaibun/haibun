/** A store without transactions writes and removes a batch one unit after another, and reports each unit it refuses in its place. */
import { describe, expect, it } from "vitest";
import { storeOfDomains } from "../../test/declared-types.js";
import { factDomainDefinition, FACT_FIELD } from "../domains/facts.js";
import { Access, FACT_LABEL } from "../../domains/resources.js";
import { WRITE_VERB, type TRemoval } from "../domains/unit.js";
import { removeEach } from "./write-many.js";

const fact = (id: string) => ({
	"@type": FACT_LABEL,
	[FACT_FIELD.id]: id,
	[FACT_FIELD.domain]: "d",
	[FACT_FIELD.value]: 1,
	[FACT_FIELD.actuality]: "a-1",
	[FACT_FIELD.generatedAtTime]: "2026-11-10T00:00:00.000Z",
	accessLevel: Access.private,
});

describe("a batch of units in a store without transactions", () => {
	it("writes each unit, and reports a create of a record the store holds while the others are written", async () => {
		const store = storeOfDomains([factDomainDefinition]);
		await store.create(fact("held"));
		const written = await store.writeMany([
			{ verb: WRITE_VERB.create, node: fact("first") },
			{ verb: WRITE_VERB.create, node: fact("held") },
			{ verb: WRITE_VERB.merge, node: fact("last") },
		]);
		expect(written.map((outcome) => ("refused" in outcome ? "refused" : outcome.id))).toEqual(["first", "refused", "last"]);
	});

	it("removes each unit, and reports a removal the store refuses while the others are made", async () => {
		const store = storeOfDomains([factDomainDefinition]);
		for (const id of ["one", "two"]) await store.create(fact(id));
		const refusing = { remove: (removal: TRemoval) => (removal.id === "held" ? Promise.reject(new Error("the store refuses it")) : store.remove(removal)) };
		const removed = await removeEach(
			refusing,
			["one", "held", "two"].map((id) => ({ label: FACT_LABEL, id })),
		);
		expect(removed).toEqual([{ removed: { label: FACT_LABEL, id: "one" } }, { refused: "the store refuses it" }, { removed: { label: FACT_LABEL, id: "two" } }]);
		expect(await store.readRecords({ label: FACT_LABEL, limit: 10 })).toMatchObject({ vertices: [] });
	});
});
