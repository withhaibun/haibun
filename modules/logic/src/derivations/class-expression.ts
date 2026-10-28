/**
 * Reads a class expression in Manchester syntax (W3C Note), in the fragment OWL 2 RL evaluates completely for a query: a named
 * class, `and`, `or`, `{property} some {expression}` and `{property} value {individual}`, each property also as `inverse
 * {property}`, with parentheses. An individual is written as its address, `Type:id`. A mix of `and` and `or` takes
 * parentheses, so each reads one way. The constructs RL doesn't evaluate for a query are refused, each with its reason and
 * the form to write instead. Writes an expression as the N3 rules that derive its members, in DL notation and as a
 * plain-English reading.
 */
import { DataFactory } from "n3";
import type { NamedNode, Quad_Object, Quad_Subject } from "@rdfjs/types";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { pattern, ruleText, type TN3Pattern } from "./n3.js";

/** A property as a restriction names it, read in its own direction or inverted. */
export type TRestricted = { property: string; inverse: boolean };
/** A class expression as its parts. */
export type TClassExpression =
	| { named: string }
	| { and: TClassExpression[] }
	| { or: TClassExpression[] }
	| (TRestricted & { some: TClassExpression })
	| (TRestricted & { value: string });

/** The rules that derive an expression's members, and the class whose members they are. */
export type TExpressionRules = { rules: string; query: string };
/** The IRIs of an expression's names: a class's, a property's and an individual's by its address. */
export type TExpressionIris = { classIri: (name: string) => NamedNode; propertyIri: (name: string) => NamedNode; individualIri: (address: string) => NamedNode };
/** The terms an expression's names are checked against: each class, and each property with the classes it connects, and the
 *  classes that subsume a class. */
export type TVocabulary = {
	classes: readonly string[];
	properties: readonly { name: string; domain: readonly string[]; range: readonly string[] }[];
	ancestors: (cls: string) => ReadonlySet<string>;
};

const TOKEN = /\(|\)|\{|\}|[^\s(){}]+/g;
const KEYWORD = { and: "and", or: "or", some: "some", value: "value", inverse: "inverse" } as const;
const KEYWORDS: ReadonlySet<string> = new Set(Object.values(KEYWORD));
const [OPEN, CLOSE] = ["(", ")"];
/** The constructs of Manchester syntax a query refuses, each with the reason and the form to write instead. */
const REFUSED: Readonly<Record<string, string>> = {
	only: "OWL 2 RL doesn't evaluate `only` in a query, since a universal over an open graph isn't proved by the facts it reads. State the positive check `every {class} is a {class}`, or read a complete graph",
	not: "the open world doesn't prove a complement: `unknown` isn't false. State the class of the records, or a disjointness in the ontology",
	min: "OWL 2 RL doesn't count a property's values in a class expression. Count a read with the `counting` combinator",
	max: "OWL 2 RL doesn't count a property's values in a class expression. Count a read with the `counting` combinator",
	exactly: "OWL 2 RL doesn't count a property's values in a class expression. Count a read with the `counting` combinator",
	"{": "braces read as haibun's interpolation. Write `individual {Type:id} is a {class}` or `{property} value Type:id`",
	"}": "braces read as haibun's interpolation. Write `individual {Type:id} is a {class}` or `{property} value Type:id`",
};

/** Returns an expression's parts. Throws with the position and the remedy where the expression doesn't parse or uses a construct
 *  a query refuses. */
export function parseClassExpression(text: string): TClassExpression {
	const tokens = text.match(TOKEN);
	let at = 0;
	const fail = (what: string): never => {
		throw new Error(
			`the class expression \`${text}\` ${what} at word ${at + 1}. Write a named class, \`and\`, \`or\`, \`{property} some {class}\` or \`{property} value {Type:id}\`, with parentheses around a mix of \`and\` and \`or\`.`,
		);
	};
	if (tokens === null) return fail("doesn't hold a word");
	const refused = tokens.findIndex((token) => REFUSED[token] !== undefined);
	if (refused >= 0) {
		const construct = itemAt(tokens, refused);
		throw new Error(`the class expression \`${text}\` uses \`${construct}\` at word ${refused + 1}: ${REFUSED[construct]}.`);
	}
	const peek = (): string | undefined => tokens[at];
	const name = (): string => {
		const token = peek();
		if (token === undefined || token === OPEN || token === CLOSE || KEYWORDS.has(token)) return fail("expects a name");
		at += 1;
		return token;
	};
	const restriction = (restricted: TRestricted): TClassExpression => {
		if (peek() === KEYWORD.some) {
			at += 1;
			return { ...restricted, some: primary() };
		}
		if (peek() === KEYWORD.value) {
			at += 1;
			return { ...restricted, value: name() };
		}
		return fail("expects `some` or `value` after an inverse property");
	};
	const primary = (): TClassExpression => {
		if (peek() === OPEN) {
			at += 1;
			const inner = expression();
			if (peek() !== CLOSE) return fail("doesn't close a parenthesis");
			at += 1;
			return inner;
		}
		if (peek() === KEYWORD.inverse) {
			at += 1;
			return restriction({ property: name(), inverse: true });
		}
		const first = name();
		return peek() === KEYWORD.some || peek() === KEYWORD.value ? restriction({ property: first, inverse: false }) : { named: first };
	};
	const expression = (): TClassExpression => {
		const parts = [primary()];
		let joining: string | undefined;
		for (let next = peek(); next === KEYWORD.and || next === KEYWORD.or; next = peek()) {
			if (joining !== undefined && joining !== next) return fail("mixes `and` and `or` without parentheses");
			joining = next;
			at += 1;
			parts.push(primary());
		}
		if (joining === undefined) return itemAt(parts, 0);
		return joining === KEYWORD.and ? { and: parts } : { or: parts };
	};
	const parsed = expression();
	if (at !== tokens.length) fail("holds a word after the expression ends");
	return parsed;
}

/** The parts directly under an expression. */
const partsOf = (expression: TClassExpression): TClassExpression[] =>
	"and" in expression ? expression.and : "or" in expression ? expression.or : "some" in expression ? [expression.some] : [];

/** Returns the names of the classes and the properties an expression names. A query reads the facts of the types they reach. */
export function namesOf(expression: TClassExpression): { classes: string[]; properties: string[] } {
	const held = partsOf(expression).map(namesOf);
	return {
		classes: [...("named" in expression ? [expression.named] : []), ...held.flatMap(({ classes }) => classes)],
		properties: [...("property" in expression ? [expression.property] : []), ...held.flatMap(({ properties }) => properties)],
	};
}

/** The edit distance between two names, which ranks the nearest name to suggest. */
function distance(a: string, b: string): number {
	let row = Array.from({ length: b.length + 1 }, (_, at) => at);
	for (let i = 1; i <= a.length; i += 1) {
		const next = [i];
		for (let j = 1; j <= b.length; j += 1) next.push(Math.min(itemAt(row, j) + 1, itemAt(next, j - 1) + 1, itemAt(row, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1)));
		row = next;
	}
	return itemAt(row, b.length);
}
const nearest = (name: string, names: readonly string[]): string => names.reduce((best, each) => (distance(name, each) < distance(name, best) ? each : best));

/** Returns why an expression's names don't hold in a vocabulary, with the nearest name or the inverse property to write, or
 *  undefined where each class and property is the vocabulary's and each restriction reads in its property's direction. */
export function nameRefusal(expression: TClassExpression, vocabulary: TVocabulary): string | undefined {
	const { classes, properties } = namesOf(expression);
	const unknownClass = classes.find((name) => !vocabulary.classes.includes(name));
	if (unknownClass !== undefined) return `the ontology doesn't hold the class ${unknownClass}. Did you mean ${nearest(unknownClass, vocabulary.classes)}?`;
	const propertyNames = vocabulary.properties.map(({ name }) => name);
	const unknownProperty = properties.find((name) => !propertyNames.includes(name));
	if (unknownProperty !== undefined) return `the ontology doesn't hold the property ${unknownProperty}. Did you mean ${nearest(unknownProperty, propertyNames)}?`;
	const within = (cls: string, bounds: readonly string[]): boolean => bounds.length === 0 || bounds.some((bound) => vocabulary.ancestors(cls).has(bound));
	const reversed = (part: TClassExpression): string | undefined => {
		if ("some" in part && "named" in part.some) {
			const declared = vocabulary.properties.find(({ name }) => name === part.property);
			const [reaches, starts] = part.inverse ? [declared?.domain, declared?.range] : [declared?.range, declared?.domain];
			if (reaches !== undefined && starts !== undefined && !within(part.some.named, reaches) && within(part.some.named, starts))
				return `${part.property} reaches ${reaches.join(" or ")}, and ${part.some.named} is in its other direction. Write \`${part.inverse ? "" : "inverse "}${part.property} some ${part.some.named}\`.`;
		}
		return partsOf(part)
			.map(reversed)
			.find((found) => found !== undefined);
	};
	return reversed(expression);
}

const member = (subject: Quad_Subject, cls: NamedNode): TN3Pattern => pattern(subject, RDF.type, cls);
/** A restriction's fact between a member and the value it reaches, in the property's direction. */
const restricted = ({ property, inverse }: TRestricted, iris: TExpressionIris, subject: Quad_Subject, object: Quad_Object): TN3Pattern =>
	inverse ? pattern(object as Quad_Subject, iris.propertyIri(property), subject) : pattern(subject, iris.propertyIri(property), object);
const [X, Y] = [DataFactory.variable("x"), DataFactory.variable("y")];

/** Returns the N3 rules that derive an expression's members as members of a class in `namespace`, with each name's IRI from `iris`. */
export function expressionRules(expression: TClassExpression, namespace: string, iris: TExpressionIris): TExpressionRules {
	const rules: string[] = [];
	let count = 0;
	const classOf = (part: TClassExpression): NamedNode => {
		if ("named" in part) return iris.classIri(part.named);
		count += 1;
		const cls = DataFactory.namedNode(`${namespace}e${count}`);
		if ("or" in part) for (const alternative of part.or) rules.push(ruleText([member(X, classOf(alternative))], [member(X, cls)]));
		else if ("and" in part)
			rules.push(
				ruleText(
					part.and.map((each) => member(X, classOf(each))),
					[member(X, cls)],
				),
			);
		else if ("some" in part) rules.push(ruleText([restricted(part, iris, X, Y), member(Y, classOf(part.some))], [member(X, cls)]));
		else rules.push(ruleText([restricted(part, iris, X, iris.individualIri(part.value))], [member(X, cls)]));
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
		count += 1;
		const reached = DataFactory.namedNode(`${namespace}v${count}`);
		return factsOf(part.some, reached).map((facts) => [restricted(part, iris, of, reached), ...facts]);
	};
	return factsOf(expression, subject);
}

/** Returns an expression in DL notation. */
export function dlOf(expression: TClassExpression): string {
	const nested = (part: TClassExpression): string => ("and" in part || "or" in part ? `(${dlOf(part)})` : dlOf(part));
	if ("named" in expression) return expression.named;
	if ("and" in expression) return expression.and.map(nested).join(" ⊓ ");
	if ("or" in expression) return expression.or.map(nested).join(" ⊔ ");
	const role = `${expression.property}${expression.inverse ? "⁻" : ""}`;
	return "some" in expression ? `∃${role}.${nested(expression.some)}` : `∃${role}.{${expression.value}}`;
}

/** Returns an expression as a plain-English reading, by fixed rules: a class is "a C", an existential is "something that P
 *  a C", a value is "something whose P is x", an inverse reads its property from the other side, `and` joins with "and", and
 *  `or` reads as "either … or …". */
export function readingOf(expression: TClassExpression): string {
	if ("named" in expression) return `a ${expression.named}`;
	if ("and" in expression) return expression.and.map(readingOf).join(" and ");
	if ("or" in expression) return `either ${expression.or.map(readingOf).join(" or ")}`;
	if ("some" in expression)
		return expression.inverse ? `something that ${readingOf(expression.some)} ${expression.property}` : `something that ${expression.property} ${readingOf(expression.some)}`;
	return expression.inverse ? `something that ${expression.value} ${expression.property}` : `something whose ${expression.property} is ${expression.value}`;
}
