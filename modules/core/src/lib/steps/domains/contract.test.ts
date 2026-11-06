/**
 * A step's contract declares its products in one of three forms, and the accessor returns the form it states: the domain, the
 * domain of each field, or the statement parameter whose products the step returns.
 */
import { describe, expect, it } from "vitest";
import { contractProducts, productDomains, StepContractSchema } from "./contract.js";

describe("contract.products", () => {
	it("reads a domain, a map of fields and a statement parameter, and an empty form for a step without a contract", () => {
		expect(contractProducts({ contract: { products: "cart" } })).toEqual({ domain: "cart" });
		expect(contractProducts({ contract: { products: { order: "order", receipt: "receipt" } } })).toEqual({ fields: { order: "order", receipt: "receipt" } });
		expect(contractProducts({ contract: { products: { of: "statement" } } })).toEqual({ of: "statement" });
		expect(contractProducts({})).toEqual({});
	});

	it("returns the domains a contract declares its products in", () => {
		expect(productDomains({ contract: { products: "cart" } })).toEqual(["cart"]);
		expect(productDomains({ contract: { products: { order: "order", receipt: "receipt" } } })).toEqual(["order", "receipt"]);
		expect(productDomains({ contract: { products: { of: "statement" } } })).toEqual([]);
	});

	it("carries each form in a descriptor, reading a lone `of` as the statement form", () => {
		for (const products of ["cart", { of: "statement" }, { order: "order", receipt: "receipt" }]) expect(StepContractSchema.parse({ products })).toEqual({ products });
		expect(contractProducts({ contract: StepContractSchema.parse({ products: { of: "statement" } }) })).toEqual({ of: "statement" });
	});
});
