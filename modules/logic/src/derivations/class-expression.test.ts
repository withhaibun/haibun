/**
 * A class expression's rules: one class per part in the rules that derive its members, a literal as an N3 literal, a datatype
 * restriction's facets as the built-ins that compare a value, a nominal's individuals and each individual the same as one, and a member that stands for any member of each alternative.
 */
import { describe, expect, it } from "vitest";
import { DataFactory } from "n3";
import { LOG, MATH, OWL, RDF, STRING } from "@haibun/core/lib/domains/vocabularies.js";
import { parseClassExpression } from "@haibun/core/lib/records/derivations/class-expression.js";
import { patternText } from "./n3.js";
import { expressionRules, frozenMembers } from "./class-expression.js";

const IRIS = {
	classIri: (name: string) => DataFactory.namedNode(`urn:c:${name}`),
	propertyIri: (name: string) => DataFactory.namedNode(`urn:p:${name}`),
	individualIri: (address: string) => DataFactory.namedNode(`urn:i:${address}`),
};
const IMPLIES = `<${LOG.implies}>`;
const TYPE = `<${RDF.type}>`;
const rulesOf = (text: string): string => expressionRules(parseClassExpression(text), "urn:q#", IRIS).rules;

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

	it("states a literal as an N3 literal, and a datatype restriction's facets as the built-ins that compare its value", () => {
		expect(rulesOf('folder value "Drafts"')).toBe(`{ ?x <urn:p:folder> "Drafts" . } ${IMPLIES} { ?x ${TYPE} <urn:q#e1> . } .`);
		expect(rulesOf('dateSent some xsd:dateTime[>= "2026-01-01T00:00:00Z", < "2026-02-01T00:00:00Z"]')).toBe(
			`{ ?x <urn:p:dateSent> ?v . ?v <${STRING.notLessThan}> "2026-01-01T00:00:00Z" . ?v <${STRING.lessThan}> "2026-02-01T00:00:00Z" . } ${IMPLIES} { ?x ${TYPE} <urn:q#e1> . } .`,
		);
		expect(rulesOf("count some xsd:integer[> 3]")).toContain(`?v <${MATH.greaterThan}> 3 .`);
		expect(rulesOf('subject some xsd:string[pattern "invoice"]')).toContain(`?v <${STRING.matches}> "invoice" .`);
	});

	it("states a nominal's individual its member, and each individual owl:sameAs it a member, and queries one individual's membership", () => {
		const { rules, membership } = expressionRules(parseClassExpression("{Person:p1}"), "urn:q#", IRIS);
		expect(rules.split("\n")).toEqual([`<urn:i:Person:p1> ${TYPE} <urn:q#e1> .`, `{ ?x <${OWL.sameAs}> <urn:i:Person:p1> . } ${IMPLIES} { ?x ${TYPE} <urn:q#e1> . } .`]);
		expect(membership(DataFactory.namedNode("urn:i:Person:p2"))).toBe(`{ <urn:i:Person:p2> ${TYPE} <urn:q#e1> . } ${IMPLIES} { <urn:i:Person:p2> ${TYPE} <urn:q#e1> . } .`);
	});
});

describe("an expression's member", () => {
	it("states a member that stands for any member of each alternative, with a fresh individual for each value an existential reaches", () => {
		const expression = parseClassExpression('Note and (isPartOf some Step or isPartOf value Step:s2 or title value "x")');
		expect(frozenMembers(expression, DataFactory.namedNode("urn:m"), "urn:q#", IRIS).map((facts) => facts.map(patternText))).toEqual([
			[`<urn:m> ${TYPE} <urn:c:Note> .`, "<urn:m> <urn:p:isPartOf> <urn:q#v1> .", `<urn:q#v1> ${TYPE} <urn:c:Step> .`],
			[`<urn:m> ${TYPE} <urn:c:Note> .`, "<urn:m> <urn:p:isPartOf> <urn:i:Step:s2> ."],
			[`<urn:m> ${TYPE} <urn:c:Note> .`, '<urn:m> <urn:p:title> "x" .'],
		]);
		expect(frozenMembers(parseClassExpression("{Step:s1, Step:s2}"), DataFactory.namedNode("urn:m"), "urn:q#", IRIS).map((facts) => facts.map(patternText))).toEqual([
			[`<urn:m> <${OWL.sameAs}> <urn:i:Step:s1> .`],
			[`<urn:m> <${OWL.sameAs}> <urn:i:Step:s2> .`],
		]);
		expect(() => frozenMembers(parseClassExpression("count some xsd:integer[> 3]"), DataFactory.namedNode("urn:m"), "urn:q#", IRIS)).toThrow(/doesn't read a datatype restriction/);
	});
});
