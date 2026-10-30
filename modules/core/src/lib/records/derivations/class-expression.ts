/**
 * Reads a class expression in Manchester syntax (W3C Note), in the fragment OWL 2 RL evaluates completely for a query: a named
 * class, `and`, `or`, `{property} some {expression}`, `{property} value {individual}` and `{property} value {literal}`, each
 * property also as `inverse {property}`, and a datatype restriction `{property} some xsd:{type}[{facet} {literal}, …]` with
 * OWL 2's facets (`>=`, `>`, `<=`, `<` and `pattern`), with parentheses. An individual is written as its address, `Type:id`,
 * a literal in double quotes, with `^^xsd:{type}` where it isn't a string, and a number bare. A property names a field of the expression's
 * class, or a relation of the ontology. A mix of `and` and `or` takes parentheses, so each reads one way. The constructs RL
 * doesn't evaluate for a query are refused, each with its reason and the form to write instead. Writes an expression in DL
 * notation and as a plain-English reading.
 */
import { itemAt } from "../../domains/item-at.js";
import { DL_SYMBOL } from "../domains/axioms.js";
import {
	DATATYPE,
	FACET,
	KEYWORD,
	literalText,
	XSD_PREFIX,
	type TClassExpression,
	type TDataRange,
	type TFacet,
	type TLiteral,
	type TRestricted,
} from "../domains/class-expression.js";

/** A property of the vocabulary: a relation, or a type's field, named by its type and its field, with the field it names. */
export type TVocabularyProperty = { name: string; domain: readonly string[]; range: readonly string[]; field?: string };
/** The terms an expression's names are checked against: each class, and each property with the classes it connects, and the
 *  classes that subsume a class. */
export type TVocabulary = { classes: readonly string[]; properties: readonly TVocabularyProperty[]; ancestors: (cls: string) => ReadonlySet<string> };

const ORDERED: ReadonlySet<string> = new Set([DATATYPE.dateTime, DATATYPE.date, DATATYPE.integer, DATATYPE.decimal]);
const DATATYPES: ReadonlySet<string> = new Set(Object.values(DATATYPE));
const TOKEN = /"(?:[^"\\]|\\.)*"(?:\^\^[^\s(){}[\],]+)?|\(|\)|\{|\}|\[|\]|,|>=|<=|>|<|[^\s(){}[\],<>"]+/g;
const KEYWORDS: ReadonlySet<string> = new Set(Object.values(KEYWORD));
const FACETS: ReadonlySet<string> = new Set(Object.values(FACET));
const [OPEN, CLOSE, OPEN_RANGE, CLOSE_RANGE, COMMA] = ["(", ")", "[", "]", ","];
const PUNCTUATION: ReadonlySet<string> = new Set([OPEN, CLOSE, OPEN_RANGE, CLOSE_RANGE, COMMA]);
const QUOTED = /^"((?:[^"\\]|\\.)*)"(?:\^\^(\S+))?$/;
/** A number written bare, which reads as an integer or a decimal. */
const NUMBER = /^-?\d+(?:\.\d+)?$/;
/** The constructs of Manchester syntax a query refuses, each with the reason and the form to write instead. */
const REFUSED: Readonly<Record<string, string>> = {
	only: "OWL 2 RL doesn't evaluate `only` in a query, since a universal over an open graph isn't proved by the facts it reads. State the positive check `every {class} is a {class}`, or read a complete graph",
	not: "the open world doesn't prove a complement: `unknown` isn't false. State the class of the records, or a disjointness in the ontology",
	min: "OWL 2 RL doesn't count a property's values in a class expression. Count a read with the `counting` combinator",
	max: "OWL 2 RL doesn't count a property's values in a class expression. Count a read with the `counting` combinator",
	exactly: "OWL 2 RL doesn't count a property's values in a class expression. Count a read with the `counting` combinator",
	"{": "braces read as haibun's interpolation. Write `individual {Type:id} is a {class}`, `{property} value Type:id`, or an `or` of `value` restrictions",
	"}": "braces read as haibun's interpolation. Write `individual {Type:id} is a {class}`, `{property} value Type:id`, or an `or` of `value` restrictions",
};

/** Returns a literal's lexical form and datatype, or undefined where the token isn't one. Production `literal`: a `typedLiteral`
 *  (`lexicalValue '^^' Datatype`), a `stringLiteralNoLanguage`, an `integerLiteral` or a `decimalLiteral`. */
function literalOf(token: string): TLiteral | undefined {
	if (NUMBER.test(token)) return { lexical: token, datatype: token.includes(".") ? DATATYPE.decimal : DATATYPE.integer };
	const quoted = QUOTED.exec(token);
	if (quoted === null) return undefined;
	const [, escaped, datatype] = quoted;
	const lexical = JSON.parse(`"${escaped}"`) as string;
	return datatype === undefined || datatype === DATATYPE.string ? { lexical } : { lexical, datatype };
}

/** Returns an expression's parts. Throws with the position and the remedy where the expression doesn't parse or uses a construct
 *  a query refuses. Each reader below follows the production of the W3C OWL 2 Manchester Syntax grammar its comment names. */
export function parseClassExpression(text: string): TClassExpression {
	const tokens = text.match(TOKEN);
	let at = 0;
	const fail = (what: string): never => {
		throw new Error(
			`the class expression \`${text}\` ${what} at word ${at + 1}. Write a named class, \`and\`, \`or\`, \`{property} some {class}\`, \`{property} value {Type:id}\`, \`{property} value "{literal}"\` or \`{property} some xsd:{type}[{facet} "{literal}"]\`, with parentheses around a mix of \`and\` and \`or\`.`,
		);
	};
	if (tokens === null) return fail("doesn't hold a word");
	const refused = tokens.findIndex((token) => REFUSED[token] !== undefined);
	if (refused >= 0) {
		const construct = itemAt(tokens, refused);
		throw new Error(`the class expression \`${text}\` uses \`${construct}\` at word ${refused + 1}: ${REFUSED[construct]}.`);
	}
	const peek = (): string | undefined => tokens[at];
	// classIRI, objectPropertyIRI, dataPropertyIRI and individual (an `individualIRI`, written as a record's address).
	const name = (): string => {
		const token = peek();
		if (token === undefined || PUNCTUATION.has(token) || KEYWORDS.has(token) || FACETS.has(token) || literalOf(token) !== undefined) return fail("expects a name");
		at += 1;
		return token;
	};
	// literal, and restrictionValue, which is a literal.
	const literal = (): TLiteral => {
		const token = peek();
		const read = token === undefined ? undefined : literalOf(token);
		if (read === undefined) return fail("expects a quoted literal");
		at += 1;
		return read;
	};
	// datatypeRestriction: Datatype '[' facet restrictionValue { ',' facet restrictionValue } ']', with the facets `>=`, `>`, `<=`, `<`
	// and `pattern`; a Datatype without facets is the dataAtomic that names it.
	const range = (datatype: string): TDataRange => {
		if (!DATATYPES.has(datatype)) return fail(`names the datatype ${datatype}, which isn't one of ${[...DATATYPES].join(", ")}`);
		const facets: TDataRange["facets"] = [];
		if (peek() !== OPEN_RANGE) return { datatype, facets };
		at += 1;
		for (;;) {
			const facet = peek();
			if (facet === undefined || !FACETS.has(facet)) return fail(`expects a facet, one of ${[...FACETS].join(", ")}`);
			if ((facet === FACET.pattern) === ORDERED.has(datatype))
				return fail(`states ${facet} of ${datatype}: \`pattern\` restricts xsd:string, and a comparison restricts an ordered datatype`);
			at += 1;
			facets.push({ facet: facet as TFacet, literal: literal() });
			if (peek() === CLOSE_RANGE) {
				at += 1;
				return { datatype, facets };
			}
			if (peek() !== COMMA) return fail("expects a comma or the end of the facets");
			at += 1;
		}
	};
	// restriction: objectPropertyExpression 'some' primary, objectPropertyExpression 'value' individual, dataPropertyExpression 'some'
	// dataPrimary, and dataPropertyExpression 'value' literal.
	const restriction = (restricted: TRestricted): TClassExpression => {
		if (peek() === KEYWORD.some) {
			at += 1;
			const next = peek();
			if (next?.startsWith(XSD_PREFIX) === true) {
				if (restricted.inverse) return fail("inverts a property whose values are literals, which don't hold a property of their own");
				at += 1;
				return { ...restricted, range: range(next) };
			}
			return { ...restricted, some: primary() };
		}
		if (peek() === KEYWORD.value) {
			at += 1;
			const next = peek();
			if (next !== undefined && literalOf(next) !== undefined)
				return restricted.inverse ? fail("inverts a property whose values are literals, which don't hold a property of their own") : { ...restricted, literal: literal() };
			return { ...restricted, value: name() };
		}
		return fail("expects `some` or `value` after a property");
	};
	// primary: a restriction or an atomic, which is a classIRI or '(' description ')'; an objectPropertyExpression is an
	// objectPropertyIRI or inverseObjectProperty, 'inverse' objectPropertyIRI. `not` and individual lists are refused above.
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
	// description: conjunction { 'or' conjunction }, and conjunction: primary { 'and' primary }. A mix of both takes parentheses.
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
export const partsOf = (expression: TClassExpression): TClassExpression[] =>
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

/** The named classes an expression's restrictions read within: the classes an `and` names beside them, and those around it. */
const scopeOf = (parts: readonly TClassExpression[], around: readonly string[]): string[] => [...around, ...parts.flatMap((part) => ("named" in part ? [part.named] : []))];

/** Returns the property a restriction's name resolves to: a field of a class it reads within, by its type and field, or else a
 *  relation of the ontology; or the refusal with the nearest name. */
function propertyFor(name: string, scope: readonly string[], vocabulary: TVocabulary): { property: string } | { refused: string } {
	const within = (cls: string) => scope.some((held) => vocabulary.ancestors(held).has(cls));
	const fields = vocabulary.properties.filter(({ field, domain }) => field !== undefined && domain.some(within));
	const field = fields.find((held) => held.field === name);
	if (field !== undefined) return { property: field.name };
	const relations = vocabulary.properties.filter(({ field }) => field === undefined);
	if (relations.some((held) => held.name === name)) return { property: name };
	const offered = [...fields.map((held) => held.field as string), ...relations.map((held) => held.name)];
	const holder = scope.length === 0 ? "the ontology doesn't hold the property" : `${scope.join(" and ")} doesn't declare the field, and the ontology doesn't hold the property`;
	return { refused: `${holder} ${name}. Did you mean ${nearest(name, offered)}?` };
}

/** Returns an expression with each restriction's property resolved to the vocabulary's property, or the refusal of a name the
 *  vocabulary doesn't hold, with the nearest name. A property names a field of the classes an `and` names beside it, or a
 *  relation. */
export function resolvedExpression(expression: TClassExpression, vocabulary: TVocabulary): TClassExpression | { refused: string } {
	const resolve = (part: TClassExpression, scope: readonly string[]): TClassExpression => {
		if ("named" in part) {
			if (!vocabulary.classes.includes(part.named)) throw new Error(`the ontology doesn't hold the class ${part.named}. Did you mean ${nearest(part.named, vocabulary.classes)}?`);
			return part;
		}
		if ("and" in part) return { and: part.and.map((each) => resolve(each, scopeOf(part.and, scope))) };
		if ("or" in part) return { or: part.or.map((each) => resolve(each, scope)) };
		const found = propertyFor(part.property, part.inverse ? [] : scope, vocabulary);
		if ("refused" in found) throw new Error(found.refused);
		return "some" in part ? { ...part, property: found.property, some: resolve(part.some, []) } : { ...part, property: found.property };
	};
	try {
		return resolve(expression, []);
	} catch (caught) {
		return { refused: caught instanceof Error ? caught.message : String(caught) };
	}
}

/** Returns why an expression's names don't hold in a vocabulary, with the nearest name or the inverse property to write, or
 *  undefined where each class and property is the vocabulary's and each restriction reads in its property's direction. */
export function nameRefusal(expression: TClassExpression, vocabulary: TVocabulary): string | undefined {
	const resolved = resolvedExpression(expression, vocabulary);
	if ("refused" in resolved) return resolved.refused;
	const within = (cls: string, bounds: readonly string[]): boolean => bounds.length === 0 || bounds.some((bound) => vocabulary.ancestors(cls).has(bound));
	const reversed = (part: TClassExpression, written: TClassExpression): string | undefined => {
		if ("some" in part && "named" in part.some && "some" in written) {
			const declared = vocabulary.properties.find(({ name }) => name === part.property);
			const [reaches, starts] = part.inverse ? [declared?.domain, declared?.range] : [declared?.range, declared?.domain];
			if (reaches !== undefined && starts !== undefined && !within(part.some.named, reaches) && within(part.some.named, starts))
				return `${written.property} reaches ${reaches.join(" or ")}, and ${part.some.named} is in its other direction. Write \`${part.inverse ? "" : "inverse "}${written.property} some ${part.some.named}\`.`;
		}
		const writtenParts = partsOf(written);
		return partsOf(part)
			.map((each, at) => reversed(each, itemAt(writtenParts, at)))
			.find((found) => found !== undefined);
	};
	return reversed(resolved, expression);
}

const FACET_DL: Record<TFacet, string> = { ">=": "≥", ">": ">", "<=": "≤", "<": "<", pattern: "pattern" };
const FACET_READING: Record<TFacet, string> = { ">=": "at least", ">": "above", "<=": "at most", "<": "below", pattern: "matching" };

/** The mark of an inverse property in DL notation. A reading in the page's text writes it, and a graph's label doesn't. */
const INVERSE_MARK = "⁻";

/** Returns an expression in DL notation. */
export function dlOf(expression: TClassExpression): string {
	const nested = (part: TClassExpression): string => ("and" in part || "or" in part ? `(${dlOf(part)})` : dlOf(part));
	if ("named" in expression) return expression.named;
	if ("and" in expression) return expression.and.map(nested).join(` ${DL_SYMBOL.intersection} `);
	if ("or" in expression) return expression.or.map(nested).join(` ${DL_SYMBOL.union} `);
	const role = `${expression.property}${expression.inverse ? INVERSE_MARK : ""}`;
	if ("some" in expression) return `${DL_SYMBOL.some}${role}.${nested(expression.some)}`;
	if ("range" in expression) {
		const { datatype, facets } = expression.range;
		return `${DL_SYMBOL.some}${role}.${datatype}${facets.length === 0 ? "" : `[${facets.map(({ facet, literal }) => `${FACET_DL[facet]} ${literalText(literal)}`).join(", ")}]`}`;
	}
	return `${DL_SYMBOL.some}${role}.{${"literal" in expression ? literalText(expression.literal) : expression.value}}`;
}

/** Returns an expression as a plain-English reading, by fixed rules: a class is "a C", an existential is "something that P
 *  a C", a value is "something whose P is x", a datatype restriction is "something whose P is a T at least x", an inverse reads
 *  its property from the other side, `and` joins with "and", and `or` reads as "either … or …". */
export function readingOf(expression: TClassExpression): string {
	if ("named" in expression) return `a ${expression.named}`;
	if ("and" in expression) return expression.and.map(readingOf).join(" and ");
	if ("or" in expression) return `either ${expression.or.map(readingOf).join(" or ")}`;
	if ("some" in expression)
		return expression.inverse ? `something that ${readingOf(expression.some)} ${expression.property}` : `something that ${expression.property} ${readingOf(expression.some)}`;
	if ("range" in expression) {
		const { datatype, facets } = expression.range;
		return `something whose ${expression.property} is a ${datatype}${facets.map(({ facet, literal }) => ` ${FACET_READING[facet]} ${literalText(literal)}`).join(" and")}`;
	}
	const value = "literal" in expression ? literalText(expression.literal) : expression.value;
	return expression.inverse ? `something that ${value} ${expression.property}` : `something whose ${expression.property} is ${value}`;
}
