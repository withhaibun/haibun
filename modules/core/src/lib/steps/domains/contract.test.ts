/**
 * A step's contract declares its products in one of three forms, and the accessor returns the form it states: the domain, the
 * domain of each field, or the statement parameter whose products the step returns.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	contractProducts,
	contractWrites,
	doesntHold,
	field,
	holds,
	parameter,
	PRINCIPAL,
	PRODUCTS,
	productDomains,
	RELATION_NAMESPACE,
	statementN3,
	statementNotation,
	StepContractSchema,
	stepWrites,
	type TRelation,
} from "./contract.js";

/** A record type as a stepper declares one, and two relations its statements share. */
const CAPABILITY = { schema: z.object({ id: z.string(), revoked: z.string() }), topology: { persistedAs: "Capability" } };
const REVOKED: TRelation = { name: "revoked_capability", phrase: { holds: "{capability} is revoked", doesntHold: "{capability} isn't revoked" }, rules: "" };
const CONTROLS: TRelation = { name: "controls", phrase: { holds: "{principal} controls {capability}", doesntHold: "{principal} doesn't control {capability}" }, rules: "" };

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

describe("contract terms", () => {
	it("builds a field from a type's declaration, and a statement from a relation and its arguments", () => {
		expect(field(CAPABILITY, "revoked")).toEqual({ persistedAs: "Capability", key: "revoked" });
		expect(doesntHold(REVOKED, parameter("parent"))).toEqual({ relation: REVOKED, args: [{ parameter: "parent" }], negated: true });
	});

	it("renders a statement in Unicode notation and as the N3 triple it asserts", () => {
		const statement = holds(CONTROLS, PRINCIPAL, parameter("parent"));
		expect(statementNotation(statement)).toBe("controls(principal, parent)");
		expect(statementNotation(doesntHold(REVOKED, PRODUCTS))).toBe("¬revoked_capability(products)");
		expect(statementN3(statement, (argument) => ("parameter" in argument ? `<urn:p:${argument.parameter}>` : "<urn:p:me>"))).toBe(
			`(<urn:p:me> <urn:p:parent>) <${RELATION_NAMESPACE}controls> true .`,
		);
	});

	it("derives the write of each persisted product, and adds the type of each field the contract lists in changes", () => {
		const persistedAs = (domain: string) => (domain === "capability" ? "Capability" : undefined);
		expect(contractWrites({ contract: { products: "capability", changes: [] } }, persistedAs)).toEqual(["Capability"]);
		expect(contractWrites({ contract: { products: "text", changes: [field(CAPABILITY, "revoked")] } }, persistedAs)).toEqual(["Capability"]);
		expect(contractWrites({ contract: { products: "text" } }, persistedAs)).toEqual([]);
	});

	it("states the writes a step in progress may make where its contract declares changes, and doesn't where the step is on the baseline", () => {
		const persistedAs = (domain: string) => (domain === "capability" ? "Capability" : undefined);
		const revoked = field(CAPABILITY, "revoked");
		expect(stepWrites({ contract: { products: "capability", changes: [revoked] } }, "S-delegate", persistedAs)).toEqual({
			step: "S-delegate",
			products: ["Capability"],
			changes: [revoked],
			refused: [],
		});
		expect(stepWrites({ contract: { products: "capability" } }, "S-delegate", persistedAs)).toBeUndefined();
	});
});
