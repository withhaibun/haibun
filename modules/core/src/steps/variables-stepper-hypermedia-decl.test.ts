import { describe, it, expect } from "vitest";
import { passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";

type Products = { topology?: { persistedAs?: string; id?: string; edges?: Record<string, { range: string; rel: string }>; sortColumns?: Record<string, string> } };
const showProducts = (res: Awaited<ReturnType<typeof passWithDefaults>>, line: string): Products =>
	((res.featureResults?.[0]?.stepResults ?? []).find((s) => s.in === line)?.products ?? {}) as Products;

describe("set of {domain} by — declare a hypermedia domain", () => {
	it("prose form registers a domain with vertex topology", async () => {
		const res = await passWithDefaults(
			`set of Recipe by id, with name
set of Ingredient by id, with name, used in Recipe
show domain ingredient`,
			[VariablesStepper],
		);
		expect(res.ok).toBe(true);
		const t = showProducts(res, "show domain ingredient").topology;
		expect(t?.persistedAs).toBe("Ingredient");
		expect(t?.id).toBe("id");
		expect(t?.edges?.usedIn).toEqual({ range: "Recipe", rel: "isPartOf" });
		expect(t?.sortColumns).toEqual({ name: "TEXT" });
	});

	it("JSON-LD form registers the same topology", async () => {
		const jsonld = JSON.stringify({ "@context": { id: "@id", name: "as:name", usedIn: { "@id": "schema:isPartOf", range: "Recipe" } }, "@queryable": ["name"] });
		const res = await passWithDefaults(
			`set of Recipe by id, with name
set of Ingredient by ${jsonld}
show domain ingredient`,
			[VariablesStepper],
		);
		expect(res.ok).toBe(true);
		expect(showProducts(res, "show domain ingredient").topology?.edges?.usedIn?.range).toBe("Recipe");
	});

	it("rejects a duplicate declaration", async () => {
		const res = await passWithDefaults(
			`set of Recipe by id, with name
set of Recipe by id, with name`,
			[VariablesStepper],
		);
		expect(res.ok).toBe(false);
	});
});
