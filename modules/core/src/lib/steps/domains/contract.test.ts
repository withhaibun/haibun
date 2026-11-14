/**
 * A step's contract declares its products in one of three forms, and the accessor returns the form it states: the domain, the
 * domain of each field, or the statement parameter whose products the step returns.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	ASSUMED_SAID,
	contractLines,
	contractProducts,
	contractWrites,
	doesntHold,
	field,
	holds,
	parameter,
	PRINCIPAL,
	PRODUCTS,
	productDomains,
	type TStepContract,
	RELATION_NAMESPACE,
	statementN3,
	statementNotation,
	StepContractSchema,
	recordChange,
	stepWrites,
	namedWrites,
	typeOfChange,
	UNITS_GIVEN,
	writeLevels,
	type TRelation,
} from "./contract.js";
import { Access, type AccessLevel } from "../../domains/resources.js";
import { WRITE_VERB } from "../../records/domains/unit.js";

/** A record type as a stepper declares one, and two relations its statements share. */
const CAPABILITY = { schema: z.object({ id: z.string(), revoked: z.string() }), topology: { persistedAs: "Capability" } };
const REVOKED: TRelation = { name: "revoked_capability", phrase: "{capability} is revoked", rules: "" };
const CONTROLS: TRelation = { name: "controls", phrase: "{principal} controls {capability}", rules: "" };

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

	it("returns the level each stored type of written products declares and each type its changes name, and an empty list where it doesn't write records", () => {
		/** A stored type's topology, which declares its level. */
		const stored = (persistedAs: string, accessLevel: AccessLevel) => ({ topology: { persistedAs, id: "id", properties: {}, accessLevel } });
		const domains = { cart: stored("Cart", Access.public), order: stored("Order", Access.private), receipt: {}, audit: stored("Audit", Access.opened) };
		const written = (products: TStepContract["products"]): TStepContract => ({ products, written: WRITE_VERB.merge });
		expect(writeLevels({ contract: written("cart") }, domains)).toEqual([Access.public]);
		expect(writeLevels({ contract: written({ order: "order", receipt: "receipt" }) }, domains), "a receipt isn't a stored type").toEqual([Access.private]);
		expect(writeLevels({ contract: { products: "cart" } }, domains), "a step that writes its own records doesn't have its products written").toEqual([]);
		expect(writeLevels({ contract: { read: true, products: "cart" } }, domains), "a read doesn't write").toEqual([]);
		expect(
			writeLevels({ contract: { products: "receipt", changes: [recordChange("Audit"), { persistedAs: "Order", key: "total" }] } }, domains),
			"the types its changes name",
		).toEqual([Access.opened, Access.private]);
		expect(() => writeLevels({ contract: written("basket") }, domains)).toThrow("the domain basket, which the domains read don't hold");
		expect(() => writeLevels({ contract: { changes: [recordChange("Basket")] } }, domains)).toThrow("the type Basket, which the domains read don't store");
	});

	it("carries each form in a descriptor, reading a lone `of` as the statement form", () => {
		for (const products of ["cart", { of: "statement" }, { order: "order", receipt: "receipt" }]) expect(StepContractSchema.parse({ products })).toEqual({ products });
		expect(contractProducts({ contract: StepContractSchema.parse({ products: { of: "statement" } }) })).toEqual({ of: "statement" });
	});

	it("carries products that rest on outside input as assumed, and states the assumption to a reader", () => {
		const contract = StepContractSchema.parse({ assumed: true, products: "entities", states: ["the entities are named"] });
		expect(contract.assumed).toBe(true);
		expect(contractLines(contract)).toEqual(["After the call: the entities are named.", ASSUMED_SAID]);
		expect(contractLines(StepContractSchema.parse({ products: "entities" }))).toEqual([]);
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
			typeOf: [],
			unitsGiven: false,
			refused: [],
			written: [],
		});
		expect(
			stepWrites({ contract: { products: "text", changes: [recordChange(CAPABILITY.topology.persistedAs), revoked] } }, "S-sync", persistedAs),
			"a type the changes list whole",
		).toEqual({ step: "S-sync", products: ["Capability"], changes: [revoked], typeOf: [], unitsGiven: false, refused: [], written: [] });
		expect(stepWrites({ contract: { products: "capability" } }, "S-delegate", persistedAs)).toBeUndefined();
		const naming = stepWrites({ contract: { products: "text", changes: [typeOfChange("label"), UNITS_GIVEN] } }, "S-create", persistedAs);
		expect(naming, "the parameters whose named type the step writes, and whether it writes the types of the units it gives").toMatchObject({
			products: [],
			typeOf: ["label"],
			unitsGiven: true,
		});
		if (naming === undefined) throw new Error("a step whose contract declares changes states its writes");
		expect(namedWrites(naming, { label: "Capability" }).products, "the type the call names is written whole").toEqual(["Capability"]);
		expect(() => namedWrites(naming, { label: 7 }), "an argument that doesn't name a type").toThrow("S-create writes the type its {label} names, and the call states 7");
	});
});
