/**
 * Reads a class expression in Manchester syntax (W3C Note), in the fragment OWL 2 RL evaluates completely for a query: a named
 * class, `and`, `or`, `{property} some {expression}` and `{property} value {individual}`, with parentheses. An individual is
 * written as its address, `Type:id`. A mix of `and`
 * and `or` takes parentheses, so each reads one way. Writes an expression as the N3 rules that derive its members, each
 * part a class of its own in the query namespace.
 */
import { itemAt } from "@haibun/core/lib/domains/item-at.js";

/** A class expression as its parts. */
export type TClassExpression =
	| { named: string }
	| { and: TClassExpression[] }
	| { or: TClassExpression[] }
	| { property: string; some: TClassExpression }
	| { property: string; value: string };

/** The rules that derive an expression's members, and the class whose members they are. */
export type TExpressionRules = { rules: string; query: string };

const TOKEN = /\(|\)|[^\s()]+/g;
const KEYWORD = { and: "and", or: "or", some: "some", value: "value" } as const;
const KEYWORDS: ReadonlySet<string> = new Set(Object.values(KEYWORD));
const [OPEN, CLOSE] = ["(", ")"];
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Returns an expression's parts. Throws with the position and the remedy where the expression doesn't parse. */
export function parseClassExpression(text: string): TClassExpression {
	const tokens = text.match(TOKEN);
	let at = 0;
	const fail = (what: string): never => {
		throw new Error(
			`the class expression \`${text}\` ${what} at word ${at + 1}. Write a named class, \`and\`, \`or\`, \`{property} some {class}\` or \`{property} value {Type:id}\`, with parentheses around a mix of \`and\` and \`or\`.`,
		);
	};
	if (tokens === null) return fail("doesn't hold a word");
	const peek = (): string | undefined => tokens[at];
	const name = (): string => {
		const token = peek();
		if (token === undefined || token === OPEN || token === CLOSE || KEYWORDS.has(token)) return fail("expects a name");
		at += 1;
		return token;
	};
	const primary = (): TClassExpression => {
		if (peek() === OPEN) {
			at += 1;
			const inner = expression();
			if (peek() !== CLOSE) return fail("doesn't close a parenthesis");
			at += 1;
			return inner;
		}
		const first = name();
		if (peek() === KEYWORD.some) {
			at += 1;
			return { property: first, some: primary() };
		}
		if (peek() === KEYWORD.value) {
			at += 1;
			return { property: first, value: name() };
		}
		return { named: first };
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

/** Returns the names of the classes and the properties an expression names. A query reads the facts of the types they reach. */
export function namesOf(expression: TClassExpression): { classes: string[]; properties: string[] } {
	if ("named" in expression) return { classes: [expression.named], properties: [] };
	if ("value" in expression) return { classes: [], properties: [expression.property] };
	const parts = "and" in expression ? expression.and : "or" in expression ? expression.or : [expression.some];
	const held = parts.map(namesOf);
	return {
		classes: held.flatMap(({ classes }) => classes),
		properties: [...("property" in expression ? [expression.property] : []), ...held.flatMap(({ properties }) => properties)],
	};
}

/** The IRIs of an expression's names: a class's, a property's and an individual's by its address. */
export type TExpressionIris = { classIri: (name: string) => string; propertyIri: (name: string) => string; individualIri: (address: string) => string };

/** Returns the N3 rules that derive an expression's members as members of a class in `namespace`, with each name's IRI from `iris`. */
export function expressionRules(expression: TClassExpression, namespace: string, iris: TExpressionIris): TExpressionRules {
	const rules: string[] = [];
	let count = 0;
	const member = (subject: string, cls: string): string => `${subject} <${RDF_TYPE}> <${cls}>`;
	const classOf = (part: TClassExpression): string => {
		if ("named" in part) return iris.classIri(part.named);
		count += 1;
		const cls = `${namespace}e${count}`;
		if ("or" in part) for (const alternative of part.or) rules.push(`{ ${member("?x", classOf(alternative))} } => { ${member("?x", cls)} } .`);
		else if ("and" in part) rules.push(`{ ${part.and.map((each) => member("?x", classOf(each))).join(" . ")} } => { ${member("?x", cls)} } .`);
		else if ("some" in part) rules.push(`{ ?x <${iris.propertyIri(part.property)}> ?y . ${member("?y", classOf(part.some))} } => { ${member("?x", cls)} } .`);
		else rules.push(`{ ?x <${iris.propertyIri(part.property)}> <${iris.individualIri(part.value)}> } => { ${member("?x", cls)} } .`);
		return cls;
	};
	const queried = classOf(expression);
	return { rules: rules.join("\n"), query: `{ ${member("?x", queried)} } => { ${member("?x", queried)} } .` };
}
