/**
 * A class expression's parts: named classes, `and`, `or`, `some` and `value` with parentheses, literals, datatype restrictions
 * with OWL 2's facets, a property resolved to a field of the expression's class or to a relation, the refusal of a mix of `and`
 * and `or` without parentheses, and its DL notation and plain-English reading.
 */
import { describe, expect, it } from "vitest";
import { dlOf, nameRefusal, namesOf, parseClassExpression, readingOf, resolvedExpression, type TVocabulary } from "./class-expression.js";

describe("parseClassExpression", () => {
	it("reads a named class, a conjunction, a disjunction, an existential and a value", () => {
		expect(parseClassExpression("Note")).toEqual({ named: "Note" });
		expect(parseClassExpression("Note and prov:Entity")).toEqual({ and: [{ named: "Note" }, { named: "prov:Entity" }] });
		expect(parseClassExpression("Note or Step")).toEqual({ or: [{ named: "Note" }, { named: "Step" }] });
		expect(parseClassExpression("isPartOf some (Step or Note)")).toEqual({ property: "isPartOf", inverse: false, some: { or: [{ named: "Step" }, { named: "Note" }] } });
		expect(parseClassExpression("isPartOf value Step:s2")).toEqual({ property: "isPartOf", inverse: false, value: "Step:s2" });
		expect(parseClassExpression("inverse isPartOf some Note")).toEqual({ property: "isPartOf", inverse: true, some: { named: "Note" } });
	});

	it("reads a literal, typed or a string, and a datatype restriction with OWL 2's facets", () => {
		expect(parseClassExpression('Email and folder value "In box"')).toEqual({ and: [{ named: "Email" }, { property: "folder", inverse: false, literal: { lexical: "In box" } }] });
		expect(parseClassExpression('dateSent value "2026-01-01T00:00:00Z"^^xsd:dateTime')).toEqual({
			property: "dateSent",
			inverse: false,
			literal: { lexical: "2026-01-01T00:00:00Z", datatype: "xsd:dateTime" },
		});
		expect(parseClassExpression('dateSent some xsd:dateTime[>= "2026-01-01", < "2026-02-01"]')).toEqual({
			property: "dateSent",
			inverse: false,
			range: {
				datatype: "xsd:dateTime",
				facets: [
					{ facet: ">=", literal: { lexical: "2026-01-01" } },
					{ facet: "<", literal: { lexical: "2026-02-01" } },
				],
			},
		});
		expect(parseClassExpression('subject some xsd:string[pattern "invoice"]')).toEqual({
			property: "subject",
			inverse: false,
			range: { datatype: "xsd:string", facets: [{ facet: "pattern", literal: { lexical: "invoice" } }] },
		});
	});

	it("refuses a facet its datatype doesn't take, a datatype it doesn't read, and an inverse of a literal's property", () => {
		expect(() => parseClassExpression('subject some xsd:string[>= "a"]')).toThrow(/`pattern` restricts xsd:string, and a comparison restricts an ordered datatype/);
		expect(() => parseClassExpression('count some xsd:integer[pattern "1"]')).toThrow(/`pattern` restricts xsd:string/);
		expect(() => parseClassExpression("count some xsd:float")).toThrow(/names the datatype xsd:float, which isn't one of/);
		expect(() => parseClassExpression('inverse folder value "x"')).toThrow(/inverts a property whose values are literals/);
	});

	it("refuses a mix of and and or without parentheses, a name it expects, and a word after the end, with the remedy", () => {
		expect(() => parseClassExpression("Note and Step or Comment")).toThrow(/mixes `and` and `or` without parentheses at word 4. Write a named class/);
		expect(() => parseClassExpression("Note and")).toThrow(/expects a name at word 3/);
		expect(() => parseClassExpression("(Note")).toThrow(/doesn't close a parenthesis/);
		expect(() => parseClassExpression("Note Step")).toThrow(/holds a word after the expression ends/);
	});

	it("refuses each construct a query doesn't evaluate, naming it, its reason and the form to write instead", () => {
		expect(() => parseClassExpression("isPartOf only Step")).toThrow(/uses `only` at word 2: OWL 2 RL doesn't evaluate `only`.*`every \{class\} is a \{class\}`/);
		expect(() => parseClassExpression("not Step")).toThrow(/uses `not` at word 1: the open world doesn't prove a complement/);
		expect(() => parseClassExpression("isPartOf exactly 0 Step")).toThrow(/uses `exactly` at word 2: .*`counting` combinator/);
		expect(() => parseClassExpression("{s2}")).toThrow(/uses `\{` at word 1: braces read as haibun's interpolation/);
	});

	it("lists the classes and the properties an expression names", () => {
		expect(namesOf(parseClassExpression("Note and isPartOf some Step"))).toEqual({ classes: ["Note", "Step"], properties: ["isPartOf"] });
	});
});

describe("names", () => {
	const vocabulary: TVocabulary = {
		classes: ["Step", "Note", "Email", "prov:Entity"],
		properties: [
			{ name: "isPartOf", domain: ["Note"], range: ["Step"] },
			{ name: "context", domain: [], range: [] },
			{ name: "Email.folder", domain: ["Email"], range: [], field: "folder" },
			{ name: "Email.account", domain: ["Email"], range: [], field: "account" },
		],
		ancestors: (cls) => new Set([cls, ...(cls === "Note" ? ["prov:Entity"] : [])]),
	};
	it("holds the ontology's names in their direction", () => {
		expect(nameRefusal(parseClassExpression("Note and isPartOf some Step"), vocabulary)).toBeUndefined();
		expect(nameRefusal(parseClassExpression("inverse isPartOf some Note"), vocabulary)).toBeUndefined();
	});
	it("resolves a property to a field of the class an `and` names beside it, or else to a relation", () => {
		expect(resolvedExpression(parseClassExpression('Email and folder value "Drafts"'), vocabulary)).toEqual({
			and: [{ named: "Email" }, { property: "Email.folder", inverse: false, literal: { lexical: "Drafts" } }],
		});
		expect(resolvedExpression(parseClassExpression('Email and context value "x"'), vocabulary)).toEqual({
			and: [{ named: "Email" }, { property: "context", inverse: false, literal: { lexical: "x" } }],
		});
	});
	it("suggests the nearest name, a field the class declares, and the inverse where a restriction reads against its property's direction", () => {
		expect(nameRefusal(parseClassExpression("Stepp"), vocabulary)).toBe("the ontology doesn't hold the class Stepp. Did you mean Step?");
		expect(nameRefusal(parseClassExpression("isPartof some Step"), vocabulary)).toBe("the ontology doesn't hold the property isPartof. Did you mean isPartOf?");
		expect(nameRefusal(parseClassExpression('Email and foldr value "x"'), vocabulary)).toBe(
			"Email doesn't declare the field, and the ontology doesn't hold the property foldr. Did you mean folder?",
		);
		expect(nameRefusal(parseClassExpression("isPartOf some Note"), vocabulary)).toBe(
			"isPartOf reaches Step, and Note is in its other direction. Write `inverse isPartOf some Note`.",
		);
	});
});

describe("an expression's notations", () => {
	it("writes DL notation and a plain-English reading by fixed rules", () => {
		const expression = parseClassExpression("Note and (isPartOf some Step or isPartOf value Step:s2)");
		expect(dlOf(expression)).toBe("Note ⊓ (∃isPartOf.Step ⊔ ∃isPartOf.{Step:s2})");
		expect(readingOf(expression)).toBe("a Note and either something that isPartOf a Step or something whose isPartOf is Step:s2");
		expect(dlOf(parseClassExpression("inverse isPartOf some Note"))).toBe("∃isPartOf⁻.Note");
		const dated = parseClassExpression('Email and dateSent some xsd:dateTime[>= "2026-01-01"]');
		expect(dlOf(dated)).toBe('Email ⊓ ∃dateSent.xsd:dateTime[≥ "2026-01-01"]');
		expect(readingOf(dated)).toBe('a Email and something whose dateSent is a xsd:dateTime at least "2026-01-01"');
	});
});
