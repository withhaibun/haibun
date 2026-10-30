/**
 * Writes a class expression as the N3 rules that derive its members, and as the facts of a member that stands for any member of
 * it, which a subsumption reads. Core reads the expression and resolves its names; a literal is an N3 literal, and a datatype
 * restriction's facets are the N3 built-ins that compare a value.
 */
import { DataFactory } from "n3";
import type { Literal, NamedNode, Quad_Object, Quad_Subject } from "@rdfjs/types";
import { MATH, NAMESPACE, RDF, STRING } from "@haibun/core/lib/domains/vocabularies.js";
import {
	DATATYPE,
	FACET,
	XSD_PREFIX,
	type TClassExpression,
	type TDataRange,
	type TFacet,
	type TLiteral,
	type TRestricted,
} from "@haibun/core/lib/records/domains/class-expression.js";
import { pattern, ruleText, type TN3Pattern } from "./n3.js";

/** The rules that derive an expression's members, and the class whose members they are. */
export type TExpressionRules = { rules: string; query: string };
/** The IRIs of an expression's names: a class's, a property's and an individual's by its address. */
export type TExpressionIris = { classIri: (name: string) => NamedNode; propertyIri: (name: string) => NamedNode; individualIri: (address: string) => NamedNode };

/** The comparison built-ins of a facet: a number compares as a number, and a time or a date as its lexical form, which orders as
 *  time does in the UTC form a record states. */
const COMPARISON: Record<Exclude<TFacet, typeof FACET.pattern>, { math: string; string: string }> = {
	[FACET.atLeast]: { math: MATH.notLessThan, string: STRING.notLessThan },
	[FACET.above]: { math: MATH.greaterThan, string: STRING.greaterThan },
	[FACET.atMost]: { math: MATH.notGreaterThan, string: STRING.notGreaterThan },
	[FACET.below]: { math: MATH.lessThan, string: STRING.lessThan },
};
const NUMERIC: ReadonlySet<string> = new Set([DATATYPE.integer, DATATYPE.decimal]);

/** A literal as an N3 term, with its datatype's IRI where it isn't a string. */
export const n3Literal = ({ lexical, datatype }: TLiteral): Literal =>
	datatype === undefined ? DataFactory.literal(lexical) : DataFactory.literal(lexical, DataFactory.namedNode(`${NAMESPACE.xsd}${datatype.slice(XSD_PREFIX.length)}`));

/** The N3 condition a facet states of a value: a comparison with its literal, or a string's pattern. */
function facetCondition(value: Quad_Subject, datatype: string, { facet, literal }: TDataRange["facets"][number]): TN3Pattern {
	if (facet === FACET.pattern) return pattern(value, STRING.matches, DataFactory.literal(literal.lexical));
	const numeric = NUMERIC.has(datatype);
	return pattern(value, numeric ? COMPARISON[facet].math : COMPARISON[facet].string, numeric ? n3Literal(literal) : DataFactory.literal(literal.lexical));
}

const member = (subject: Quad_Subject, cls: NamedNode): TN3Pattern => pattern(subject, RDF.type, cls);
/** A restriction's fact between a member and the value it reaches, in the property's direction. */
const restricted = ({ property, inverse }: TRestricted, iris: TExpressionIris, subject: Quad_Subject, object: Quad_Object): TN3Pattern =>
	inverse ? pattern(object as Quad_Subject, iris.propertyIri(property), subject) : pattern(subject, iris.propertyIri(property), object);
const [X, Y, V] = [DataFactory.variable("x"), DataFactory.variable("y"), DataFactory.variable("v")];

/** Returns the N3 rules that derive an expression's members as members of a class in `namespace`, with each name's IRI from `iris`. */
export function expressionRules(expression: TClassExpression, namespace: string, iris: TExpressionIris): TExpressionRules {
	const rules: string[] = [];
	let count = 0;
	const classOf = (part: TClassExpression): NamedNode => {
		if ("named" in part) return iris.classIri(part.named);
		count += 1;
		const cls = DataFactory.namedNode(`${namespace}e${count}`);
		const derive = (body: TN3Pattern[]) => rules.push(ruleText(body, [member(X, cls)]));
		if ("or" in part) for (const alternative of part.or) derive([member(X, classOf(alternative))]);
		else if ("and" in part) derive(part.and.map((each) => member(X, classOf(each))));
		else if ("some" in part) derive([restricted(part, iris, X, Y), member(Y, classOf(part.some))]);
		else if ("range" in part) derive([restricted(part, iris, X, V), ...part.range.facets.map((facet) => facetCondition(V, part.range.datatype, facet))]);
		else derive([restricted(part, iris, X, "literal" in part ? n3Literal(part.literal) : iris.individualIri(part.value))]);
		return cls;
	};
	const queried = classOf(expression);
	return { rules: rules.join("\n"), query: ruleText([member(X, queried)], [member(X, queried)]) };
}

/** Returns, for each alternative of an expression, the facts of a member that stands for any member of that alternative: the
 *  individual `subject`, with a fresh individual in `namespace` for each value an existential reaches. An expression subsumes
 *  another where each alternative's member is a member of the other. */
export function frozenMembers(expression: TClassExpression, subject: NamedNode, namespace: string, iris: TExpressionIris): TN3Pattern[][] {
	let count = 0;
	const factsOf = (part: TClassExpression, of: NamedNode): TN3Pattern[][] => {
		if ("named" in part) return [[member(of, iris.classIri(part.named))]];
		if ("or" in part) return part.or.flatMap((alternative) => factsOf(alternative, of));
		if ("and" in part) return part.and.reduce<TN3Pattern[][]>((joined, each) => joined.flatMap((facts) => factsOf(each, of).map((more) => [...facts, ...more])), [[]]);
		if ("value" in part) return [[restricted(part, iris, of, iris.individualIri(part.value))]];
		if ("literal" in part) return [[restricted(part, iris, of, n3Literal(part.literal))]];
		if ("range" in part)
			throw new Error("a subsumption doesn't read a datatype restriction, since a fresh individual doesn't represent its members. Read the members with `individuals of`.");
		count += 1;
		const reached = DataFactory.namedNode(`${namespace}v${count}`);
		return factsOf(part.some, reached).map((facts) => [restricted(part, iris, of, reached), ...facts]);
	};
	return factsOf(expression, subject);
}
