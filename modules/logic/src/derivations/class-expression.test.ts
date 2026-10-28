/**
 * A class expression's parts and its rules: named classes, `and`, `or`, `some` and `value` with parentheses, the refusal of a
 * mix of `and` and `or` without parentheses, and one class per part in the rules that derive its members.
 */
import { describe, expect, it } from "vitest";
import { DataFactory } from "n3";
import { LOG, RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { patternText } from "./n3.js";
import { dlOf, expressionRules, frozenMembers, nameRefusal, namesOf, parseClassExpression, readingOf, type TVocabulary } from "./class-expression.js";

describe("parseClassExpression", () => {
	it("reads a named class, a conjunction, a disjunction, an existential and a value", () => {
		expect(parseClassExpression("Note")).toEqual({ named: "Note" });
		expect(parseClassExpression("Note and prov:Entity")).toEqual({ and: [{ named: "Note" }, { named: "prov:Entity" }] });
		expect(parseClassExpression("Note or Step")).toEqual({ or: [{ named: "Note" }, { named: "Step" }] });
		expect(parseClassExpression("isPartOf some (Step or Note)")).toEqual({ property: "isPartOf", inverse: false, some: { or: [{ named: "Step" }, { named: "Note" }] } });
		expect(parseClassExpression("isPartOf value Step:s2")).toEqual({ property: "isPartOf", inverse: false, value: "Step:s2" });
		expect(parseClassExpression("inverse isPartOf some Note")).toEqual({ property: "isPartOf", inverse: true, some: { named: "Note" } });
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

const IRIS = {
	classIri: (name: string) => DataFactory.namedNode(`urn:c:${name}`),
	propertyIri: (name: string) => DataFactory.namedNode(`urn:p:${name}`),
	individualIri: (address: string) => DataFactory.namedNode(`urn:i:${address}`),
};
const IMPLIES = `<${LOG.implies}>`;
const TYPE = `<${RDF.type}>`;

describe("expressionRules", () => {
	it("derives a named class's members by its own class, and each other part by a class of the query", () => {
		expect(expressionRules({ named: "Note" }, "urn:q#", IRIS).rules).toBe("");
		const { rules, query } = expressionRules(parseClassExpression("Note and isPartOf some Step"), "urn:q#", IRIS);
		expect(rules.split("\n")).toEqual([
			`{ ?x <urn:p:isPartOf> ?y . ?y ${TYPE} <urn:c:Step> . } ${IMPLIES} { ?x ${TYPE} <urn:q#e2> . } .`,
			`{ ?x ${TYPE} <urn:c:Note> . ?x ${TYPE} <urn:q#e2> . } ${IMPLIES} { ?x ${TYPE} <urn:q#e1> . } .`,
		]);
		expect(query).toBe(`{ ?x ${TYPE} <urn:q#e1> . } ${IMPLIES} { ?x ${TYPE} <urn:q#e1> . } .`);
	});
});

describe("nameRefusal", () => {
	const vocabulary: TVocabulary = {
		classes: ["Step", "Note", "prov:Entity"],
		properties: [{ name: "isPartOf", domain: ["Note"], range: ["Step"] }],
		ancestors: (cls) => new Set([cls, ...(cls === "Note" ? ["prov:Entity"] : [])]),
	};
	it("holds the ontology's names in their direction", () => {
		expect(nameRefusal(parseClassExpression("Note and isPartOf some Step"), vocabulary)).toBeUndefined();
		expect(nameRefusal(parseClassExpression("inverse isPartOf some Note"), vocabulary)).toBeUndefined();
	});
	it("suggests the nearest name, and the inverse where a restriction reads against its property's direction", () => {
		expect(nameRefusal(parseClassExpression("Stepp"), vocabulary)).toBe("the ontology doesn't hold the class Stepp. Did you mean Step?");
		expect(nameRefusal(parseClassExpression("isPartof some Step"), vocabulary)).toBe("the ontology doesn't hold the property isPartof. Did you mean isPartOf?");
		expect(nameRefusal(parseClassExpression("isPartOf some Note"), vocabulary)).toBe(
			"isPartOf reaches Step, and Note is in its other direction. Write `inverse isPartOf some Note`.",
		);
	});
});

describe("an expression's notations and its member", () => {
	const expression = parseClassExpression("Note and (isPartOf some Step or isPartOf value Step:s2)");
	it("writes DL notation and a plain-English reading by fixed rules", () => {
		expect(dlOf(expression)).toBe("Note ⊓ (∃isPartOf.Step ⊔ ∃isPartOf.{Step:s2})");
		expect(readingOf(expression)).toBe("a Note and either something that isPartOf a Step or something whose isPartOf is Step:s2");
		expect(dlOf(parseClassExpression("inverse isPartOf some Note"))).toBe("∃isPartOf⁻.Note");
	});
	it("states a member that stands for any member of each alternative, with a fresh individual for each value an existential reaches", () => {
		expect(frozenMembers(expression, DataFactory.namedNode("urn:m"), "urn:q#", IRIS).map((facts) => facts.map(patternText))).toEqual([
			[`<urn:m> ${TYPE} <urn:c:Note> .`, "<urn:m> <urn:p:isPartOf> <urn:q#v1> .", `<urn:q#v1> ${TYPE} <urn:c:Step> .`],
			[`<urn:m> ${TYPE} <urn:c:Note> .`, "<urn:m> <urn:p:isPartOf> <urn:i:Step:s2> ."],
		]);
	});
});
