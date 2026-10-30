/**
 * The compilation of a class expression to a store's index: the type, a field's value, an `or` of one field's values, facets and
 * plain-text patterns run as filters, and the rest is entailed by the reasoner, with where each part ran.
 */
import { describe, expect, it } from "vitest";
import { parseClassExpression } from "./class-expression.js";
import { compiledExpression } from "./compiled-expression.js";
import { manchesterOf, hasValue } from "../domains/class-expression.js";

const FILTERABLE = { types: ["Email", "Person"], fieldsOf: (label: string) => (label === "Email" ? ["folder", "dateSent", "subject", "inReplyTo"] : ["name"]) };
const compiled = (text: string, label?: string) => compiledExpression(parseClassExpression(text), label, FILTERABLE);

describe("an expression's compilation to the index", () => {
	it("reads a named type, a field's value, an or of one field's values, facets and a plain-text pattern as filters", () => {
		expect(compiled('Email and folder value "Drafts"')).toEqual({
			label: "Email",
			filters: [{ predicate: "folder", operator: "eq", value: "Drafts" }],
			ran: { index: 'Email and folder value "Drafts"' },
		});
		expect(compiled('folder value "Drafts" or folder value "Sent"', "Email").filters).toEqual([
			{ predicate: "folder", operator: "in", value: "Drafts", values: ["Drafts", "Sent"] },
		]);
		expect(compiled('dateSent some xsd:dateTime[>= "2026-01-01T00:00:00Z", < "2026-02-01T00:00:00Z"]', "Email").filters).toEqual([
			{ predicate: "dateSent", operator: "gte", value: "2026-01-01T00:00:00Z" },
			{ predicate: "dateSent", operator: "lt", value: "2026-02-01T00:00:00Z" },
		]);
		expect(compiled('subject some xsd:string[pattern "invoice"]', "Email").filters).toEqual([{ predicate: "subject", operator: "contains", value: "invoice" }]);
		expect(compiled("inReplyTo value Email:m1", "Email").filters).toEqual([{ predicate: "inReplyTo", operator: "eq", value: "m1" }]);
	});

	it("leaves to the reasoner what needs entailment, and states where each part ran", () => {
		const { label, filters, entailed, ran } = compiled('Email and folder value "Drafts" and (inverse inReplyTo some Email) and subject some xsd:string[pattern "^Re"]');
		expect({ label, filters }).toEqual({ label: "Email", filters: [{ predicate: "folder", operator: "eq", value: "Drafts" }] });
		expect(entailed).toEqual(parseClassExpression('(inverse inReplyTo some Email) and subject some xsd:string[pattern "^Re"]'));
		expect(ran).toEqual({ index: 'Email and folder value "Drafts"', reasoner: 'inverse inReplyTo some Email and subject some xsd:string[pattern "^Re"]' });
		expect(compiled("prov:Entity").ran).toEqual({ reasoner: "prov:Entity" });
		expect(compiled('folder value "Drafts" or name value "x"', "Email").entailed).toBeDefined();
	});

	it("writes an expression in Manchester syntax that reads back as the same expression", () => {
		const text = 'Email and (folder value "Drafts" or folder value "Sent") and dateSent some xsd:dateTime[>= "2026-01-01T00:00:00Z"^^xsd:dateTime]';
		expect(parseClassExpression(manchesterOf(parseClassExpression(text)))).toEqual(parseClassExpression(text));
		expect(manchesterOf(hasValue("count", "3", "xsd:integer"))).toBe('count value "3"^^xsd:integer');
	});
});
