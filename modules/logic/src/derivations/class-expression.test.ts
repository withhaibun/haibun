/**
 * A class expression's parts and its rules: named classes, `and`, `or`, `some` and `value` with parentheses, the refusal of a
 * mix of `and` and `or` without parentheses, and one class per part in the rules that derive its members.
 */
import { describe, expect, it } from "vitest";
import { expressionRules, namesOf, parseClassExpression } from "./class-expression.js";

describe("parseClassExpression", () => {
	it("reads a named class, a conjunction, a disjunction, an existential and a value", () => {
		expect(parseClassExpression("Note")).toEqual({ named: "Note" });
		expect(parseClassExpression("Note and prov:Entity")).toEqual({ and: [{ named: "Note" }, { named: "prov:Entity" }] });
		expect(parseClassExpression("Note or Step")).toEqual({ or: [{ named: "Note" }, { named: "Step" }] });
		expect(parseClassExpression("isPartOf some (Step or Note)")).toEqual({ property: "isPartOf", some: { or: [{ named: "Step" }, { named: "Note" }] } });
		expect(parseClassExpression("isPartOf value Step:s2")).toEqual({ property: "isPartOf", value: "Step:s2" });
	});

	it("refuses a mix of and and or without parentheses, a name it expects, and a word after the end, with the remedy", () => {
		expect(() => parseClassExpression("Note and Step or Comment")).toThrow(/mixes `and` and `or` without parentheses at word 4. Write a named class/);
		expect(() => parseClassExpression("Note and")).toThrow(/expects a name at word 3/);
		expect(() => parseClassExpression("(Note")).toThrow(/doesn't close a parenthesis/);
		expect(() => parseClassExpression("Note Step")).toThrow(/holds a word after the expression ends/);
	});

	it("lists the classes and the properties an expression names", () => {
		expect(namesOf(parseClassExpression("Note and isPartOf some Step"))).toEqual({ classes: ["Note", "Step"], properties: ["isPartOf"] });
	});
});

describe("expressionRules", () => {
	const iris = { classIri: (name: string) => `urn:c:${name}`, propertyIri: (name: string) => `urn:p:${name}`, individualIri: (address: string) => `urn:i:${address}` };
	it("derives a named class's members by its own class, and each other part by a class of the query", () => {
		expect(expressionRules({ named: "Note" }, "urn:q#", iris).rules).toBe("");
		const { rules, query } = expressionRules(parseClassExpression("Note and isPartOf some Step"), "urn:q#", iris);
		const type = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";
		expect(rules.split("\n")).toEqual([
			`{ ?x <urn:p:isPartOf> ?y . ?y ${type} <urn:c:Step> } => { ?x ${type} <urn:q#e2> } .`,
			`{ ?x ${type} <urn:c:Note> . ?x ${type} <urn:q#e2> } => { ?x ${type} <urn:q#e1> } .`,
		]);
		expect(query).toBe(`{ ?x ${type} <urn:q#e1> } => { ?x ${type} <urn:q#e1> } .`);
	});
});
