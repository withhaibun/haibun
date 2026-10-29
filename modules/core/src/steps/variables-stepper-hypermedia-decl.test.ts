import { describe, it, expect } from "vitest";
import { passWithDefaults } from "../lib/test/lib.js";
import { LogicStepper } from "../lib/test/logic-stepper.js";
import VariablesStepper from "./variables-stepper.js";
import { Access } from "../lib/domains/resources.js";
import { z } from "zod";
import { DOMAIN_LABEL, DomainRecordSchema } from "../lib/records/domains/domain-record.js";

/** The topology of the domain `key`, as its Domain record states it. */
const TopologySchema = z.object({
	persistedAs: z.string(),
	id: z.string(),
	edges: z.record(z.string(), z.object({ range: z.string(), rel: z.string() })),
	sortColumns: z.record(z.string(), z.string()).optional(),
});
async function topologyOf(res: Awaited<ReturnType<typeof passWithDefaults>>, key: string): Promise<z.infer<typeof TopologySchema>> {
	const record = await res.world.shared.getStore().readRecord({ label: DOMAIN_LABEL, schema: DomainRecordSchema }, key);
	return TopologySchema.parse(record?.topology);
}

describe("set of {domain} by, declare a hypermedia domain, which its Domain record states", () => {
	it("prose form registers a domain with vertex topology", async () => {
		const res = await passWithDefaults(
			`set of Recipe by id, with name, stored at private
set of Ingredient by id, with name, used in Recipe, stored at private`,
			[VariablesStepper, LogicStepper],
		);
		expect(res.ok).toBe(true);
		const t = await topologyOf(res, "ingredient");
		expect(t.persistedAs).toBe("Ingredient");
		expect(t.id).toBe("id");
		expect(t.edges.usedIn).toEqual({ range: "Recipe", rel: "isPartOf" });
		expect(t.sortColumns).toEqual({ name: "TEXT" });
	});

	it("JSON-LD form registers the same topology", async () => {
		const jsonld = JSON.stringify({
			"@context": { id: "@id", name: "as:name", usedIn: { "@id": "schema:isPartOf", range: "Recipe" } },
			"@queryable": ["name"],
			"@accessLevel": Access.private,
		});
		const res = await passWithDefaults(
			`set of Recipe by id, with name, stored at private
set of Ingredient by ${jsonld}`,
			[VariablesStepper, LogicStepper],
		);
		expect(res.ok).toBe(true);
		expect((await topologyOf(res, "ingredient")).edges.usedIn?.range).toBe("Recipe");
	});

	it("refuses a type that doesn't state the storage level of its records, in either form", async () => {
		const prose = await passWithDefaults("set of Recipe by id, with name", [VariablesStepper, LogicStepper]);
		expect(prose.ok).toBe(false);
		expect(JSON.stringify(prose.failure)).toContain(`the declaration doesn't state the storage level of its records. Add the clause \\"stored at <level>\\"`);
		const jsonld = await passWithDefaults(`set of Recipe by ${JSON.stringify({ "@context": { id: "@id", name: "as:name" } })}`, [VariablesStepper, LogicStepper]);
		expect(jsonld.ok).toBe(false);
		expect(JSON.stringify(jsonld.failure)).toContain("@accessLevel");
	});

	it("rejects a duplicate declaration", async () => {
		const res = await passWithDefaults(
			`set of Recipe by id, with name, stored at private
set of Recipe by id, with name, stored at private`,
			[VariablesStepper, LogicStepper],
		);
		expect(res.ok).toBe(false);
	});
});
