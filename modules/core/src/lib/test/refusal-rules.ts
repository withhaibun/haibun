/**
 * The refusals a repository's source builds, read through the TypeScript parser, and where each falls short of the rule
 * that a refusal states its cause and carries its remedy as data. A refusal is a step's `actionNotOK`, a call of a
 * transport's refusal builder, the gate's refusal thrown as an error, or a returned or sent object: one holding only
 * `error`, `ok: false` and `remedy`, or an MCP result with `isError: true`.
 */
import ts from "typescript";
import type { TFound } from "./baseline.js";
import { constInitializers, lineOf, type TSources } from "./repository-files.js";

/** The words a refusal's own text holds at least, where it doesn't include another value: a subject, a verb and an object. */
const WORDS_OF_A_CAUSE = 3;
/** The words a refusal holds at least beside a caught error, which state what failed while the error states why. */
const WORDS_BESIDE_AN_ERROR = 2;
const WORD = /\p{L}+/gu;
const STEP_REFUSAL = "actionNotOK";
/** The transport's refusal builders, each by the position of the message it takes. */
const BUILDERS: Record<string, number> = { authorityRefusal: 0, refuseInvocation: 1, callFailed: 1 };
/** The gate's refusals, which name the action a caller lacks, and which a caller acts on by requesting it from a holder. */
const GATE_REFUSALS = new Set(["refusal", "namedRefusal"]);
/** The statuses that refuse the caller's sign-in or authority, on which a caller acts. */
const AUTHORITY_STATUSES = new Set(["401", "403", "407", "REFUSED_INVOCATION"]);
const REFUSAL_PROPERTIES = new Set(["ok", "error", "remedy"]);
const ERROR = "error";
const REMEDY = "remedy";
const MESSAGE = "message";
const PROMISE_CATCH = "catch";
/** The method of an HTTP context that sends a response with a JSON body and a status. */
const JSON_RESPONSE = "json";
/** The operators whose result is one of their operands. */
const ALTERNATIVES = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken]);

export const RELAYS_A_CAUGHT_ERROR = "relays a caught error without stating what failed";
export const STATES_FEW_WORDS = "doesn't state its cause in words";
export const LACKS_A_REMEDY = "names what a caller can act on without carrying a remedy";

/** What a refusal's message holds, for one of its alternatives: its literal words, and whether it includes a caught error or another value. */
type TMessage = { words: number; caught: boolean; relays: boolean };
type TRefusal = { message: ts.Expression; actionable: boolean };

/** The names a catch clause or a promise's catch handler binds, each with the node its binding covers. */
function caughtBindings(source: ts.SourceFile): { name: string; scope: ts.Node }[] {
	const caught: { name: string; scope: ts.Node }[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCatchClause(node) && node.variableDeclaration !== undefined && ts.isIdentifier(node.variableDeclaration.name)) {
			caught.push({ name: node.variableDeclaration.name.text, scope: node.block });
		}
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === PROMISE_CATCH) {
			const [handler] = node.arguments;
			if (handler !== undefined && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
				const [parameter] = handler.parameters;
				if (parameter !== undefined && ts.isIdentifier(parameter.name)) caught.push({ name: parameter.name.text, scope: handler.body });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return caught;
}

const wordsIn = (text: string): number => [...text.matchAll(WORD)].length;
const unwrapped = (node: ts.Expression): ts.Expression =>
	ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)
		? unwrapped(node.expression)
		: node;
/** Each pair of alternatives joined, as a message holds both parts. */
const joined = (left: TMessage[], right: TMessage[]): TMessage[] =>
	left.flatMap((a) => right.map((b) => ({ words: a.words + b.words, caught: a.caught || b.caught, relays: a.relays || b.relays })));
const LITERAL = (text: string): TMessage[] => [{ words: wordsIn(text), caught: false, relays: false }];
const RELAYED: TMessage[] = [{ words: 0, caught: false, relays: true }];
const CAUGHT: TMessage[] = [{ words: 0, caught: true, relays: false }];

/** Reads what each alternative of a message expression holds, through the file's consts. */
class MessageReader {
	private readonly caught: { name: string; scope: ts.Node }[];
	private readonly consts: Map<string, ts.Expression>;
	constructor(source: ts.SourceFile) {
		this.caught = caughtBindings(source);
		this.consts = constInitializers(source);
	}

	private isCaught(node: ts.Expression): boolean {
		const bare = unwrapped(node);
		if (ts.isPropertyAccessExpression(bare) && bare.name.text === MESSAGE) return this.isCaught(bare.expression);
		return ts.isIdentifier(bare) && this.caught.some(({ name, scope }) => name === bare.text && scope.pos <= bare.pos && bare.end <= scope.end);
	}

	read(node: ts.Expression, reading: ReadonlySet<string> = new Set()): TMessage[] {
		const bare = unwrapped(node);
		if (this.isCaught(bare)) return CAUGHT;
		if (ts.isStringLiteralLike(bare)) return LITERAL(bare.text);
		if (ts.isTemplateExpression(bare)) {
			return bare.templateSpans.reduce((sofar, span) => joined(joined(sofar, this.read(span.expression, reading)), LITERAL(span.literal.text)), LITERAL(bare.head.text));
		}
		if (ts.isBinaryExpression(bare) && bare.operatorToken.kind === ts.SyntaxKind.PlusToken) return joined(this.read(bare.left, reading), this.read(bare.right, reading));
		if (ts.isBinaryExpression(bare) && ALTERNATIVES.has(bare.operatorToken.kind)) return [...this.read(bare.left, reading), ...this.read(bare.right, reading)];
		if (ts.isConditionalExpression(bare)) return [...this.read(bare.whenTrue, reading), ...this.read(bare.whenFalse, reading)];
		if (ts.isIdentifier(bare)) {
			const initializer = this.consts.get(bare.text);
			return initializer === undefined || reading.has(bare.text) ? RELAYED : this.read(initializer, new Set([...reading, bare.text]));
		}
		// A call that converts or describes one caught error relays it, as `String(e)` and `errorDetail(e)` do.
		if (ts.isCallExpression(bare) && bare.arguments.length === 1 && bare.arguments.every((argument) => this.isCaught(argument))) return CAUGHT;
		return RELAYED;
	}
}

/** Where one alternative of a message falls short of stating its cause. */
function causeFinding({ words, caught, relays }: TMessage): string | undefined {
	if (caught) return words < WORDS_BESIDE_AN_ERROR ? RELAYS_A_CAUGHT_ERROR : undefined;
	return !relays && words < WORDS_OF_A_CAUSE ? STATES_FEW_WORDS : undefined;
}

const calleeName = (call: ts.CallExpression | ts.NewExpression): string | undefined => {
	const { expression } = call;
	return ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined;
};
const builtByGate = (message: ts.Expression): boolean => {
	const bare = unwrapped(message);
	const name = ts.isCallExpression(bare) ? calleeName(bare) : undefined;
	return name !== undefined && GATE_REFUSALS.has(name);
};
const propertyNamed = (object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined =>
	object.properties.find((property) => property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === name);
const initializerOf = (property: ts.ObjectLiteralElementLike | undefined): ts.Expression | undefined =>
	property === undefined ? undefined : ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;

/** The status of the response a `json(body, status)` call sends, where the object is its body. */
function responseStatus(object: ts.ObjectLiteralExpression): string | undefined {
	const { parent } = object;
	if (!ts.isCallExpression(parent) || calleeName(parent) !== JSON_RESPONSE || parent.arguments[0] !== object) return undefined;
	const status = parent.arguments[1];
	return status === undefined ? undefined : status.getText();
}

/** Whether an object is a function's result or an HTTP response's body, through parentheses, casts and conditional branches. */
function returnedOrSent(object: ts.Expression): boolean {
	const { parent } = object;
	if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isConditionalExpression(parent)) return returnedOrSent(parent);
	if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === object)) return true;
	return ts.isCallExpression(parent) && calleeName(parent) === JSON_RESPONSE && parent.arguments[0] === object;
}

/** The refusal an object literal is: one holding only `error`, `ok: false` and `remedy`, or an MCP result with `isError: true`, which a function returns or an HTTP response sends. */
function objectRefusal(object: ts.ObjectLiteralExpression): TRefusal | undefined {
	if (!returnedOrSent(object)) return undefined;
	const isError = initializerOf(propertyNamed(object, "isError"));
	if (isError !== undefined && isError.kind === ts.SyntaxKind.TrueKeyword) {
		const content = initializerOf(propertyNamed(object, "content"));
		const [first] = content !== undefined && ts.isArrayLiteralExpression(content) ? content.elements : [];
		const text = first !== undefined && ts.isObjectLiteralExpression(first) ? initializerOf(propertyNamed(first, "text")) : undefined;
		return text === undefined ? undefined : { message: text, actionable: builtByGate(text) };
	}
	const refusalShaped = object.properties.every((property) => property.name !== undefined && ts.isIdentifier(property.name) && REFUSAL_PROPERTIES.has(property.name.text));
	const message = initializerOf(propertyNamed(object, ERROR));
	const ok = initializerOf(propertyNamed(object, "ok"));
	if (message === undefined || ts.isFunctionLike(message) || !refusalShaped) return undefined;
	if (ok !== undefined && ok.kind !== ts.SyntaxKind.FalseKeyword) return undefined;
	const status = responseStatus(object);
	const withoutRemedy = propertyNamed(object, REMEDY) === undefined;
	return { message, actionable: withoutRemedy && (builtByGate(message) || (status !== undefined && AUTHORITY_STATUSES.has(status))) };
}

/** Each refusal a source file builds. */
function refusalsOf(source: ts.SourceFile): TRefusal[] {
	const found: TRefusal[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const name = calleeName(node);
			const builder = name === undefined ? undefined : BUILDERS[name];
			const message = name === STEP_REFUSAL ? node.arguments[0] : builder === undefined ? undefined : node.arguments[builder];
			if (message !== undefined) found.push({ message, actionable: false });
		} else if (ts.isNewExpression(node) && calleeName(node) === "Error") {
			const message = node.arguments?.[0];
			if (message !== undefined && builtByGate(message)) found.push({ message, actionable: true });
		} else if (ts.isObjectLiteralExpression(node)) {
			const refusal = objectRefusal(node);
			if (refusal !== undefined) found.push(refusal);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** The findings of each file's refusals: a message that doesn't state its cause, and a refusal a caller can act on without a remedy. */
export function refusalFindings(sources: TSources): TFound[] {
	return [...sources].flatMap(([file, source]) => {
		const reader = new MessageReader(source);
		return refusalsOf(source).flatMap(({ message, actionable }) => {
			const cause = reader
				.read(message)
				.map(causeFinding)
				.find((finding) => finding !== undefined);
			return [...(cause === undefined ? [] : [cause]), ...(actionable ? [LACKS_A_REMEDY] : [])].map((finding) => ({ file, finding, line: lineOf(message) }));
		});
	});
}
