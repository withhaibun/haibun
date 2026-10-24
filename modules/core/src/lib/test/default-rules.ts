/**
 * The default values a repository's source states, read through the TypeScript parser, and the default values its compose
 * files state. A value that is absent is refused with a message that names what supplies it, or its type states it as
 * optional and the code reads its absence by name. A default replaces it with another value.
 *
 * A finding in a source file is one of these:
 * - `a ?? b`, `a ??= b`, `a || b` or `a ||= b` where `b` is a constant expression;
 * - a parameter's initializer;
 * - a binding element's initializer, in a destructured parameter or declaration;
 * - a call of a method named `default`, which a zod schema defines.
 *
 * A constant expression is a string, number, bigint, boolean or regular expression literal, a template, an array or object
 * literal, a `new` expression, an upper-case name (`MAX_PAGE_ROWS`), a property of a name that starts with an upper-case
 * letter (`Access.public`), a const of the same file whose initializer is a constant expression, or a conditional whose two
 * branches are constant expressions. `null` and `undefined` aren't constant expressions, since each states the absence.
 *
 * A finding in a compose file is each `${VAR:-value}` and `${VAR-value}`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { TFound } from "./baseline.js";
import { constInitializers, lineOf, unwrapped, type TSources } from "./repository-files.js";

export const FILLS_ABSENT = "fills an absent value with a constant through ??";
export const FILLS_FALSY = "fills a falsy value with a constant through ||";
export const PARAMETER_DEFAULT = "states a parameter's default value";
export const DESTRUCTURED_DEFAULT = "states a destructured default value";
export const SCHEMA_DEFAULT = "states a schema's default value through .default()";
export const COMPOSE_DEFAULT = "states a compose variable's default value";

const NULLISH_OPERATORS = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);
const FALSY_OPERATORS = new Set([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.BarBarEqualsToken]);
const LITERAL_KINDS = new Set([
	ts.SyntaxKind.StringLiteral,
	ts.SyntaxKind.NoSubstitutionTemplateLiteral,
	ts.SyntaxKind.TemplateExpression,
	ts.SyntaxKind.NumericLiteral,
	ts.SyntaxKind.BigIntLiteral,
	ts.SyntaxKind.TrueKeyword,
	ts.SyntaxKind.FalseKeyword,
	ts.SyntaxKind.RegularExpressionLiteral,
	ts.SyntaxKind.ArrayLiteralExpression,
	ts.SyntaxKind.ObjectLiteralExpression,
	ts.SyntaxKind.NewExpression,
]);
const SIGNS = new Set([ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken]);
/** A name that holds a constant by convention: upper-case words joined by underscores. */
const CONSTANT_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const UPPER_INITIAL = /^[A-Z]/;
const NUMBER_NAMES = new Set(["Infinity", "NaN"]);
const SCHEMA_DEFAULT_METHOD = "default";
/** A compose variable with a default value: `${VAR:-value}` or `${VAR-value}`. */
const COMPOSE_VARIABLE_DEFAULT = /\$\{[A-Za-z_][A-Za-z0-9_]*:?-[^}]*\}/g;
/** An empty set of const names. A read of an expression starts with it, and adds the name of each const it reads. */
const NOT_READING: ReadonlySet<string> = new Set();
const COMPOSE_FILES = ["*compose*.yml", "*compose*.yaml"];

/** Whether a property access is a chain of names whose first name starts with an upper-case letter. */
function constantProperty(node: ts.PropertyAccessExpression): boolean {
	const { expression } = node;
	if (ts.isIdentifier(expression)) return UPPER_INITIAL.test(expression.text);
	return ts.isPropertyAccessExpression(expression) && constantProperty(expression);
}

/** Returns whether an expression is a constant expression, reading a name through the file's consts. */
function isConstant(node: ts.Expression, consts: Map<string, ts.Expression>, reading: ReadonlySet<string>): boolean {
	if (LITERAL_KINDS.has(node.kind)) return true;
	if (unwrapped(node) !== node) return isConstant(unwrapped(node), consts, reading);
	if (ts.isPrefixUnaryExpression(node)) return SIGNS.has(node.operator) && isConstant(node.operand, consts, reading);
	if (ts.isConditionalExpression(node)) return isConstant(node.whenTrue, consts, reading) && isConstant(node.whenFalse, consts, reading);
	if (ts.isPropertyAccessExpression(node)) return constantProperty(node) || CONSTANT_NAME.test(node.name.text);
	if (!ts.isIdentifier(node)) return false;
	if (CONSTANT_NAME.test(node.text) || NUMBER_NAMES.has(node.text)) return true;
	const initializer = consts.get(node.text);
	return initializer !== undefined && !reading.has(node.text) && isConstant(initializer, consts, new Set([...reading, node.text]));
}

/** The finding a node is, where it is one. */
function findingOf(node: ts.Node, consts: Map<string, ts.Expression>): string | undefined {
	if (ts.isBinaryExpression(node)) {
		const operator = node.operatorToken.kind;
		if (NULLISH_OPERATORS.has(operator) && isConstant(node.right, consts, NOT_READING)) return FILLS_ABSENT;
		if (FALSY_OPERATORS.has(operator) && isConstant(node.right, consts, NOT_READING)) return FILLS_FALSY;
		return undefined;
	}
	if (ts.isParameter(node)) return node.initializer === undefined ? undefined : PARAMETER_DEFAULT;
	if (ts.isBindingElement(node)) return node.initializer === undefined ? undefined : DESTRUCTURED_DEFAULT;
	if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === SCHEMA_DEFAULT_METHOD) return SCHEMA_DEFAULT;
	return undefined;
}

/** Each default value a source file states, at its line. */
function sourceDefaults(file: string, source: ts.SourceFile): TFound[] {
	const consts = constInitializers(source);
	const found: TFound[] = [];
	const visit = (node: ts.Node): void => {
		const finding = findingOf(node, consts);
		if (finding !== undefined) found.push({ file, finding, line: lineOf(node) });
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** The compose files git tracks in a repository, by their paths from the repository root. */
export function composeFiles(repository: string): string[] {
	return execFileSync("git", ["ls-files", "--", ...COMPOSE_FILES], { cwd: repository, encoding: "utf-8" })
		.split("\n")
		.filter((path) => path !== "")
		.sort();
}

/** Each default value a compose file states, at its line. */
function composeDefaults(repository: string, file: string): TFound[] {
	return readFileSync(join(repository, file), "utf-8")
		.split("\n")
		.flatMap((text, at) => [...text.matchAll(COMPOSE_VARIABLE_DEFAULT)].map(() => ({ file, finding: COMPOSE_DEFAULT, line: at + 1 })));
}

/** The default values that `sources` and the `compose` files of the repository state, each at its line. */
export function defaultFindings(repository: string, sources: TSources, compose: readonly string[]): TFound[] {
	return [...[...sources].flatMap(([file, source]) => sourceDefaults(file, source)), ...compose.flatMap((file) => composeDefaults(repository, file))];
}
