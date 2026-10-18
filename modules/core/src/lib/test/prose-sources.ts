/**
 * The prose of a source file, as the blocks the Writing rules read. A TypeScript or JavaScript file's prose is its comments,
 * read through the compiler's scanner so a comment marker inside a string isn't a comment, and its strings where their
 * position holds prose. A Markdown file's prose is its lines outside fenced code. A feature's prose is the lines haibun's
 * resolver reads as prose. A shell script's prose is its comments and the text it echoes, and a test group's configuration's
 * prose is its descriptions.
 */
import { basename, extname } from "node:path";
import ts from "typescript";

export type TProseKind = "comment" | "string" | "markdown";
export type TLine = { line: number; text: string };
/**
 * A paragraph, a comment or a string: a clause doesn't continue from one block into the next. `instructs` is false where
 * the block describes code, as a comment, a test's title and an assertion's message do, so a verb that opens a sentence of
 * the block isn't an instruction to the reader.
 */
export type TProseBlock = { kind: TProseKind; lines: TLine[]; instructs: boolean };

const MARKDOWN_EXTENSION = ".md";
const FEATURE_EXTENSION = ".feature";
const SHELL_EXTENSION = ".sh";
const CONFIGURATION_FILE = "config.json";
const SCRIPT_KINDS = new Map<string, ts.ScriptKind>([
	[".ts", ts.ScriptKind.TS],
	[".tsx", ts.ScriptKind.TSX],
	[".js", ts.ScriptKind.JS],
	[".mjs", ts.ScriptKind.JS],
	[".cjs", ts.ScriptKind.JS],
]);
const FEATURE_SUFFIX = ".feature.ts";
/** A unit test, or a fake that tests share: a string there is data, but for the positions `proseInTest` names. */
const TEST_FILE = /\.test(?:-fake)?\.[cm]?[jt]sx?$/;

/** A step's pattern or exact text is code, so the value of these properties isn't prose. */
const STEP_PATTERN_PROPERTIES = new Set(["gwta", "exact"]);
/** Calls whose string arguments are selectors, patterns, query statements, a far side's reply, a step's products or text under a prose check. */
const NON_PROSE_SINKS = new Set([
	"querySelector",
	"querySelectorAll",
	"closest",
	"locator",
	"waitForSelector",
	"RegExp",
	"query",
	"rpcAnswer",
	"actionOKWithProducts",
	"proseOf",
	"violationsIn",
]);
/** Matchers whose arguments are the values a test expects. */
const MATCHERS = new Set([
	"toBe",
	"toEqual",
	"toStrictEqual",
	"toContain",
	"toContainEqual",
	"toMatch",
	"toMatchObject",
	"toThrow",
	"toThrowError",
	"toHaveProperty",
	"toHaveBeenCalledWith",
	"toHaveLength",
]);
const EXPECT = "expect";
/** Calls whose first argument is a test's title: `describe`, a `describe…` helper, `it`, `test`, `suite` and `bench`, and the call `each` returns. */
const TEST_TITLE_CALL = /^(?:describe\w*|it|test|suite|bench)$/;
/** Calls whose argument is a message a person reads: an error, and a step's failure. */
const MESSAGE_CALL = /^(?:\w*Error|actionNotOK)$/;
const MESSAGE_PARAMETER = "message";
const DESCRIPTION_PROPERTY = "description";
/** Properties and parameters whose string is a fixture's record content or a fixture person's question, such as an email a fixture person wrote. */
const DATA_PROPERTIES = new Set(["body", "bodyHtml", "bodyMarkdown", "subject", "prompt"]);
/** Calls whose string argument is a fixture person's words: shu's step helper takes the question a reader types. */
const DATA_CALLS = new Set(["askExchange"]);
/** The unit test runners (lib.ts) whose first argument is a feature's text, or a list of features that each hold it as `content`. */
const FEATURE_TEXT_RUNNERS = new Set(["passWithDefaults", "failWithDefaults", "testWithDefaults"]);
const FEATURE_PATH_PROPERTY = "path";
const FEATURE_CONTENT_PROPERTY = "content";
/** A feature file's builder arguments that hold a step line, as the statement domain does. */
const STATEMENT_PROPERTIES = new Set(["statement", "statements", "condition", "action"]);
/** A feature file's builder arguments whose value is prose: titles, notes, a comment's text, a reason and a role. Its other arguments are a step's values. */
const FEATURE_PROSE_PROPERTIES = new Set(["feature", "scenario", "title", "text", "note", "role", "purpose", "rationale", "description"]);
/** The exports of a feature file whose values are its features or backgrounds, each a list of lines. */
const KIREJI_EXPORT_TYPE = "TKirejiExport";
const KIREJI_EXPORT_NAMES = new Set(["features", "backgrounds"]);
/** The tag of a stylesheet template, whose prose is its comments. */
const CSS_TAG = "css";
/** What a template's substitution reads as in its prose. */
const TEMPLATE_SUBSTITUTION = "${…}";
/** A literal haibun quotes as a whole, as a step's argument is quoted: its quotes are syntax, so its prose is what they hold. */
const QUOTED_LITERAL = /^"([^"]*)"$/;
/** The kinds of node `TStringNode` names. The walk tests every node's kind against them. */
const STRING_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
	ts.SyntaxKind.StringLiteral,
	ts.SyntaxKind.NoSubstitutionTemplateLiteral,
	ts.SyntaxKind.TemplateExpression,
	ts.SyntaxKind.JsxText,
]);
/** The kinds of node that hold a fact `readSource` reads: a function's or a variable's declaration, a call, a property and an object literal. */
const FACT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
	ts.SyntaxKind.FunctionDeclaration,
	ts.SyntaxKind.VariableDeclaration,
	ts.SyntaxKind.CallExpression,
	ts.SyntaxKind.NewExpression,
	ts.SyntaxKind.PropertyAssignment,
	ts.SyntaxKind.ObjectLiteralExpression,
]);

const LINE_BREAK = /\r?\n/;
const LINE_COMMENT_MARKER = /^\/\/+/;
const TRIPLE_SLASH_DIRECTIVE = /^\/\/\/\s*<(?:reference|amd-module|amd-dependency)\b/;
const BLOCK_COMMENT_OPEN = /^\/\*\*?/;
const BLOCK_COMMENT_CLOSE = /\*\/$/;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const JSDOC_MARGIN = /^\s*\*(?!\/)/;
const JSDOC_TAG = /^@\w/;
/** A paragraph of a licence notice that a derived file carries verbatim, or the licence's address on its own. */
const LICENCE_PARAGRAPH = /^(?:Copyright \(c\) |Licensed under the Apache License|Unless required by applicable law)|^https?:\/\/\S+$/;
/** Only whitespace and one line break lie between two line comments of one paragraph. */
const ADJACENT_LINE = /^[^\S\n]*\n[^\S\n]*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const MARKDOWN_ITEM = /^(?:[-*+]\s|\d+[.)]\s)/;
const MARKDOWN_SINGLE_LINE = /^(?:#{1,6}\s|\|)/;
const SHELL_COMMENT = /^\s*#(?!!)\s?(.*)$/;
const SHELL_ECHO = /\becho\s+"((?:[^"\\]|\\.)*)"/g;

/** A feature line the resolver reads as prose (Resolver.ts): a sentence, which starts with a capital and ends with punctuation. */
const FEATURE_SENTENCE = /^\p{Lu}.*[.!?:;]$/u;
/** A heading line, whose title is prose however it ends. */
const FEATURE_HEADING = /^(?:Feature|Scenario|Activity|Backgrounds?):/;
/** A line that opens with markup, a quoted sentence of four or more words, or code followed by a lower-case word: prose where a step doesn't match it. */
const FEATURE_MARKUP = /^(?:\*\*|\[|#|>|\(|\d+[.)]\s|["“][^"”\s]+(?:\s+[^"”\s]+){3}|`[^`]+`\s+\p{Ll})/u;
/** A step's quoted argument, read as prose where it holds a sentence of four or more words. */
const QUOTED_ARGUMENT = /"([^"]+)"/g;
const QUOTED_SENTENCE = /^\S+(?:\s+\S+){3,}.*[.?!]$/;
const ACTIVITY_LINE = /^Activity:\s*(.+)$/i;
const WAYPOINT_LINE = /^waypoint\s+(.+)$/i;
const WAYPOINT_RESOLVES = /^(.+?)\s+resolves\s+\S+$/i;
const WAYPOINT_PROOF = " with ";
const WAYPOINT_PARAMETER = /\{[^}]+\}/;
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** What a string of a script is to the rules: code, data, prose, prose that describes code (a test's title), or feature text. */
type TStringUse = "code" | "data" | "prose" | "describes" | "feature";
/** A function the file declares, by the indices of its parameters whose argument is a message or a fixture's content. */
type THelper = { message: Set<number>; data: Set<number> };
type TSourceFacts = { featureText: Set<ts.Node>; helpers: Map<string, THelper>; isTest: boolean; isFeature: boolean };
type TStringNode = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression | ts.JsxText;
/** What one walk of a source reads: its comments in source order, its strings in source order, and the facts that classify a string's position. */
type TSourceRead = { comments: ts.CommentRange[]; strings: TStringNode[]; facts: TSourceFacts };
/** A declaration of a function, whose parameters a call names by position. */
type THelperDeclaration = ts.SignatureDeclarationBase & { body?: ts.Node };
type TLiteralPiece = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail;
type TArgument = { call: ts.CallExpression | ts.NewExpression; index: number };

/** True for a file whose prose the rules read. */
export function isProseFile(path: string): boolean {
	const extension = extname(path);
	return SCRIPT_KINDS.has(extension) || [MARKDOWN_EXTENSION, FEATURE_EXTENSION, SHELL_EXTENSION].includes(extension) || basename(path) === CONFIGURATION_FILE;
}

/** The blocks of prose a file holds. */
export function proseBlocks(path: string, text: string): TProseBlock[] {
	const extension = extname(path);
	if (extension === MARKDOWN_EXTENSION) return markdownBlocks(text);
	if (extension === FEATURE_EXTENSION) return featureFileBlocks(text);
	if (extension === SHELL_EXTENSION) return shellBlocks(text);
	if (basename(path) === CONFIGURATION_FILE) return configurationBlocks(path, text);
	const scriptKind = SCRIPT_KINDS.get(extension);
	if (scriptKind === undefined) throw new Error(`${path} isn't a file whose prose the rules read: a script, Markdown, a feature, a shell script or ${CONFIGURATION_FILE}`);
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
	const read = readSource(source, path);
	return [...commentBlocks(source, read.comments), ...stringBlocks(source, read)];
}

/** Lines grouped into paragraphs: a blank line or a gap in line numbers ends one, a line `starts` matches begins one, and a line `single` matches is its own. */
function paragraphs(lines: readonly TLine[], starts: RegExp, single?: RegExp): TLine[][] {
	const result: TLine[][] = [];
	let current: TLine[] = [];
	let previous: { line: number; single: boolean } | undefined;
	for (const { line, text } of lines) {
		const trimmed = text.trim();
		const isSingle = single?.test(trimmed) ?? false;
		const begins = previous === undefined || previous.single || line !== previous.line + 1 || starts.test(trimmed) || isSingle;
		if ((trimmed === "" || begins) && current.length > 0) {
			result.push(current);
			current = [];
		}
		if (trimmed !== "") current.push({ line, text: trimmed });
		previous = trimmed === "" ? undefined : { line, single: isSingle };
	}
	if (current.length > 0) result.push(current);
	return result;
}

function markdownBlocks(text: string): TProseBlock[] {
	const prose: TLine[] = [];
	let fence: string | undefined;
	text.split(LINE_BREAK).forEach((line, index) => {
		const marker = FENCE.exec(line)?.[1];
		if (fence !== undefined) {
			if (marker !== undefined && marker.charAt(0) === fence.charAt(0) && marker.length >= fence.length && line.trim() === marker) fence = undefined;
		} else if (marker !== undefined) fence = marker;
		else prose.push({ line: index + 1, text: line });
	});
	return paragraphs(prose, MARKDOWN_ITEM, MARKDOWN_SINGLE_LINE).map((lines) => ({ kind: "markdown", lines, instructs: true }));
}

/** A shell script's comment lines as Markdown paragraphs, and the text each `echo` writes as a string. The first line's `#!` is code. */
function shellBlocks(text: string): TProseBlock[] {
	const lines = text.split(LINE_BREAK);
	const comments = lines.flatMap((line, index) => {
		const comment = SHELL_COMMENT.exec(line)?.[1];
		return comment === undefined ? [] : [{ line: index + 1, text: comment }];
	});
	const echoes = lines.flatMap((line, index) =>
		[...line.matchAll(SHELL_ECHO)].flatMap(([, echoed]): TProseBlock[] =>
			echoed?.includes(" ") ? [{ kind: "string", lines: [{ line: index + 1, text: echoed }], instructs: true }] : [],
		),
	);
	return [...paragraphs(comments, MARKDOWN_ITEM).map((lines): TProseBlock => ({ kind: "markdown", lines, instructs: true })), ...echoes];
}

/** The `description` strings of a test group's configuration. */
function configurationBlocks(path: string, text: string): TProseBlock[] {
	const source = ts.parseJsonText(path, text);
	const blocks: TProseBlock[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isPropertyAssignment(node) && propertyName(node.name) === DESCRIPTION_PROPERTY && ts.isStringLiteral(node.initializer)) {
			blocks.push({
				kind: "string",
				lines: [{ line: source.getLineAndCharacterOfPosition(node.initializer.getStart(source)).line + 1, text: node.initializer.text }],
				instructs: true,
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return blocks;
}

/**
 * One walk of a source: every comment, read from the full start of each node, list and token, and the facts and strings that
 * `stringBlocks` reads. A scanner reads the punctuation and keyword tokens between a node's children, as the compiler's
 * `getChildren` does, without building a node for each. JSX text is text, so its full start isn't read. A JSDoc comment is
 * a comment, and the walk doesn't enter it.
 */
function readSource(source: ts.SourceFile, path: string): TSourceRead {
	const { text } = source;
	const isFeature = path.endsWith(FEATURE_SUFFIX);
	const comments = new Map<number, ts.CommentRange>();
	const strings: TStringNode[] = [];
	const declared = new Map<string, ts.Expression[]>();
	const roots: ts.Node[] = [];
	const helperDeclarations = new Map<string, THelperDeclaration>();
	const messageNames = new Map<ts.Node, Set<string>>();
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
	// The walk reads positions in source order, so a position equal to the last one read holds the same comments.
	let lastRead: number | undefined;
	const readCommentsAt = (at: number): void => {
		if (at === lastRead) return;
		lastRead = at;
		for (const range of [...(ts.getLeadingCommentRanges(text, at) ?? []), ...(ts.getTrailingCommentRanges(text, at) ?? [])]) comments.set(range.pos, range);
	};
	const readTokens = (from: number, to: number): void => {
		scanner.resetTokenState(from);
		for (let at = from; at < to; ) {
			const token = scanner.scan();
			const end = scanner.getTokenEnd();
			if (end <= to) readCommentsAt(at);
			at = end;
			if (token === ts.SyntaxKind.EndOfFileToken) return;
		}
	};
	const visit = (node: ts.Node): void => {
		if (!ts.isJsxText(node)) readCommentsAt(node.pos);
		readFacts(node);
		if (node.kind < ts.SyntaxKind.FirstNode) return;
		let at = node.pos;
		const child = (next: ts.Node): void => {
			readTokens(at, next.pos);
			visit(next);
			at = next.end;
		};
		const list = (nodes: ts.NodeArray<ts.Node>): void => {
			readTokens(at, nodes.pos);
			readCommentsAt(nodes.pos);
			at = nodes.pos;
			for (const next of nodes) child(next);
			readTokens(at, nodes.end);
			at = nodes.end;
		};
		ts.forEachChild(node, child, list);
		readTokens(at, node.end);
	};
	const readFacts = (node: ts.Node): void => {
		if (isStringNode(node)) strings.push(node);
		if (!FACT_KINDS.has(node.kind)) return;
		if (ts.isFunctionDeclaration(node) && node.name !== undefined) helperDeclarations.set(node.name.text, node);
		else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
			const { initializer } = node;
			declared.set(node.name.text, [...(declared.get(node.name.text) ?? []), initializer]);
			if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) helperDeclarations.set(node.name.text, initializer);
			if (isFeature && isKirejiExport(node)) roots.push(...kirejiSteps(initializer));
		} else if (ts.isCallExpression(node) && FEATURE_TEXT_RUNNERS.has(calleeName(node.expression) ?? "")) roots.push(...node.arguments.slice(0, 1));
		else if (isFeature && ts.isPropertyAssignment(node) && STATEMENT_PROPERTIES.has(propertyName(node.name) ?? "")) roots.push(node.initializer);
		const content = ts.isObjectLiteralExpression(node) ? featureContent(node) : undefined;
		if (content !== undefined) roots.push(content);
		if (isMessageCall(node)) readMessageNames(node, messageNames);
	};
	visit(source);
	const isTest = TEST_FILE.test(path);
	const helpers = new Map([...helperDeclarations].map(([name, declaration]) => [name, helperOfDeclaration(declaration, messageNames.get(declaration))]));
	const facts: TSourceFacts = { featureText: featureTextFrom(roots, declared), helpers, isTest, isFeature };
	return { comments: [...comments.values()].sort((a, b) => a.pos - b.pos), strings, facts };
}

/** A block comment's lines without its markers or its JSDoc margin, from the source line on which it starts. */
function blockCommentLines(raw: string, line: number): TLine[] {
	return raw
		.replace(BLOCK_COMMENT_OPEN, "")
		.replace(BLOCK_COMMENT_CLOSE, "")
		.split(LINE_BREAK)
		.map((text, index) => ({ line: line + index, text: text.replace(JSDOC_MARGIN, "") }));
}

/** A comment's lines without its markers, by source line. A triple-slash directive is code. */
function commentLines(source: ts.SourceFile, range: ts.CommentRange): TLine[] {
	const raw = source.text.slice(range.pos, range.end);
	const line = source.getLineAndCharacterOfPosition(range.pos).line + 1;
	if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) return TRIPLE_SLASH_DIRECTIVE.test(raw) ? [] : [{ line, text: raw.replace(LINE_COMMENT_MARKER, "") }];
	return blockCommentLines(raw, line);
}

/** A comment's paragraphs, which a JSDoc tag also begins. A licence notice's paragraphs are its licensor's text, so they aren't read. */
function commentParagraphs(lines: readonly TLine[]): TProseBlock[] {
	return paragraphs(lines, JSDOC_TAG)
		.filter((paragraph) => !LICENCE_PARAGRAPH.test(paragraph[0]?.text ?? ""))
		.map((lines) => ({ kind: "comment", lines, instructs: false }));
}

/** Comments as paragraphs: line comments on adjacent lines form one. */
function commentBlocks(source: ts.SourceFile, comments: readonly ts.CommentRange[]): TProseBlock[] {
	const groups: TLine[][] = [];
	let previous: ts.CommentRange | undefined;
	for (const range of comments) {
		const lines = commentLines(source, range);
		const last = groups.at(-1);
		const continues =
			previous?.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
			range.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
			ADJACENT_LINE.test(source.text.slice(previous.end, range.pos));
		if (continues && last !== undefined) last.push(...lines);
		else groups.push(lines);
		previous = range;
	}
	return groups.flatMap(commentParagraphs);
}

/** The lines of a literal's text, each by the source line on which it starts. An escaped line break (`\n`) starts a line on the same source line. */
function literalLines(source: ts.SourceFile, start: number, raw: string, cooked: string): TLine[] {
	const first = source.getLineAndCharacterOfPosition(start).line + 1;
	const texts = cooked.split("\n");
	const starts = [first];
	let line = first;
	for (let at = 0; at < raw.length; at++) {
		const character = raw.charAt(at);
		if (character === "\\") {
			const escaped = raw.charAt(at + 1);
			if (escaped === "n") starts.push(line);
			else if (escaped === "\n") line++;
			else if (escaped === "\r") {
				line++;
				if (raw.charAt(at + 2) === "\n") at++;
			}
			at++;
		} else if (character === "\n") {
			line++;
			starts.push(line);
		}
	}
	// A line break written as a code point escape doesn't start a source line, so such a literal's lines are read on its first line.
	const lineNumbers = starts.length === texts.length ? starts : texts.map(() => first);
	return texts.map((text, index) => {
		const number = lineNumbers[index];
		if (number === undefined) throw new RangeError(`line ${index} is outside the ${lineNumbers.length} line numbers of a literal at line ${first}`);
		return { line: number, text };
	});
}

/** The source text between a literal's delimiters: a quote or backtick opens and closes it, and `${` or `}` bounds a template's piece. */
function rawText(source: ts.SourceFile, node: TLiteralPiece): string {
	return node.getText(source).slice(1, ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? -2 : -1);
}

function isStringNode(node: ts.Node): node is TStringNode {
	return STRING_KINDS.has(node.kind);
}

/**
 * The text a substitution reads as in place: a literal it holds directly, or the first branch of a conditional that holds
 * text, so a template nested in a substitution continues the outer template's sentence. Each literal read in place joins `inPlace`.
 */
function substitutionText(source: ts.SourceFile, expression: ts.Expression, inPlace: Set<ts.Node>): string | undefined {
	if (ts.isParenthesizedExpression(expression)) return substitutionText(source, expression.expression, inPlace);
	if (ts.isConditionalExpression(expression)) return substitutionText(source, expression.whenTrue, inPlace) ?? substitutionText(source, expression.whenFalse, inPlace);
	if (!isStringNode(expression) || ts.isJsxText(expression)) return undefined;
	const text = stringLines(source, expression, inPlace)
		.map(({ text }) => text)
		.join(" ");
	if (text === "") return undefined;
	inPlace.add(expression);
	return text;
}

/** A string's lines, trimmed; a template's substitution reads as one placeholder within its line, or as the literal it holds. */
function stringLines(source: ts.SourceFile, node: TStringNode, inPlace: Set<ts.Node>): TLine[] {
	if (ts.isJsxText(node)) return literalLines(source, node.pos, node.text, node.text).map(({ line, text }) => ({ line, text: text.trim() }));
	const pieces: { piece: TLiteralPiece; before?: ts.Expression }[] = ts.isTemplateExpression(node)
		? [{ piece: node.head }, ...node.templateSpans.map((span) => ({ piece: span.literal, before: span.expression }))]
		: [{ piece: node }];
	const lines = pieces.reduce<TLine[]>((joined, { piece, before }) => {
		const [first, ...rest] = literalLines(source, piece.getStart(source) + 1, rawText(source, piece), piece.text);
		const last = joined.at(-1);
		if (first === undefined) throw new RangeError(`a literal at ${piece.getStart(source)} doesn't have a line`);
		if (last === undefined || before === undefined) return [...joined, first, ...rest];
		const substitution = substitutionText(source, before, inPlace) ?? TEMPLATE_SUBSTITUTION;
		return [...joined.slice(0, -1), { line: last.line, text: `${last.text}${substitution}${first.text}` }, ...rest];
	}, []);
	return lines.map(({ line, text }) => ({ line, text: text.trim() }));
}

/** A string's lines without the quotes in which haibun wraps a literal. */
function unquoted(lines: readonly TLine[]): TLine[] {
	return lines.map(({ line, text }) => ({ line, text: QUOTED_LITERAL.exec(text)?.[1] ?? text }));
}

function propertyName(name: ts.Node): string | undefined {
	return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function calleeName(expression: ts.Expression): string | undefined {
	if (ts.isIdentifier(expression)) return expression.text;
	return ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined;
}

/** The identifier a call chain starts from: `it` for `it.each(table)`, `expect` for `expect(value).rejects`. */
function rootName(expression: ts.Expression): string | undefined {
	if (ts.isIdentifier(expression)) return expression.text;
	if (ts.isPropertyAccessExpression(expression) || ts.isCallExpression(expression) || ts.isElementAccessExpression(expression)) return rootName(expression.expression);
	return undefined;
}

/** Operators whose result can be the value of their right operand: concatenation, a fallback and a condition. */
const PASSING_OPERATORS = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken]);
/** The expressions that pass their operand's value through whole: a parenthesis, a template, a cast and a non-null assertion. */
const WRAPPING_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
	ts.SyntaxKind.ParenthesizedExpression,
	ts.SyntaxKind.TemplateSpan,
	ts.SyntaxKind.TemplateExpression,
	ts.SyntaxKind.AsExpression,
	ts.SyntaxKind.SatisfiesExpression,
	ts.SyntaxKind.NonNullExpression,
]);

/** True where `node` passes the value `from` holds to the expression around it: a parenthesis, a conditional, a template, a cast, a concatenation or a fallback. */
function wraps(node: ts.Node, from: ts.Node): boolean {
	if (ts.isConditionalExpression(node)) return node.condition !== from;
	if (ts.isBinaryExpression(node)) return PASSING_OPERATORS.has(node.operatorToken.kind);
	return WRAPPING_KINDS.has(node.kind);
}

/** True where `node` passes `from` through to the expression around it, so a string inside an argument is passed with the argument. */
function passesThrough(node: ts.Node, from: ts.Node): boolean {
	return (
		wraps(node, from) ||
		ts.isArrayLiteralExpression(node) ||
		ts.isObjectLiteralExpression(node) ||
		ts.isSpreadElement(node) ||
		(ts.isPropertyAssignment(node) && node.initializer === from)
	);
}

/** The outermost node `node`'s value reaches through the expressions `through` passes it. */
function climb(node: ts.Node, through: (parent: ts.Node, from: ts.Node) => boolean): ts.Node {
	let passed = node;
	while (through(passed.parent, passed)) passed = passed.parent;
	return passed;
}

/** The call that takes the value as an argument, and its index, through the expressions `through` passes it. */
function argumentOf(node: ts.Node, through: (parent: ts.Node, from: ts.Node) => boolean): TArgument | undefined {
	const passed = climb(node, through);
	const call = passed.parent;
	if (!ts.isCallExpression(call) && !ts.isNewExpression(call)) return undefined;
	const index = call.arguments?.findIndex((argument) => argument === passed) ?? -1;
	return index === -1 ? undefined : { call, index };
}

/** The name of the property, or the class's field, whose value is the string, through the expressions `through` passes it. */
function propertyOf(node: ts.Node, through: (parent: ts.Node, from: ts.Node) => boolean = wraps): string | undefined {
	const passed = climb(node, through);
	const parent = passed.parent;
	return (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.initializer === passed ? propertyName(parent.name) : undefined;
}

/** True where `node` passes `from` to the expression around it, or lists it in an array. */
function wrapsOrLists(node: ts.Node, from: ts.Node): boolean {
	return wraps(node, from) || ts.isArrayLiteralExpression(node);
}

/** A call of `expect` itself, as `expect(value, message)` or `expect.soft(value, message)`. */
function isExpectCall(call: ts.Node): call is ts.CallExpression {
	if (!ts.isCallExpression(call)) return false;
	const callee = call.expression;
	return (ts.isIdentifier(callee) && callee.text === EXPECT) || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === EXPECT);
}

function isMessageCall(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
	return (ts.isCallExpression(node) || ts.isNewExpression(node)) && MESSAGE_CALL.test(calleeName(node.expression) ?? "");
}

/** True where a string is code: a property key, a module specifier, a literal type, a step pattern, or an argument a non-prose sink takes. */
function isCode(node: ts.Node): boolean {
	const parent = node.parent;
	const isKey =
		("name" in parent && parent.name === node) ||
		(ts.isBindingElement(parent) && parent.propertyName === node) ||
		ts.isComputedPropertyName(parent) ||
		(ts.isElementAccessExpression(parent) && parent.argumentExpression === node);
	const isModuleSpecifier =
		ts.isImportDeclaration(parent) ||
		ts.isExportDeclaration(parent) ||
		ts.isExternalModuleReference(parent) ||
		(ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || calleeName(parent.expression) === "require"));
	if (isKey || isModuleSpecifier || ts.isLiteralTypeNode(parent)) return true;
	const argument = argumentOf(node, passesThrough);
	if (argument !== undefined && NON_PROSE_SINKS.has(calleeName(argument.call.expression) ?? "")) return true;
	for (let child: ts.Node = node; !ts.isSourceFile(child.parent); child = child.parent) {
		if (ts.isPropertyAssignment(child.parent) && child.parent.initializer === child && STEP_PATTERN_PROPERTIES.has(propertyName(child.parent.name) ?? "")) return true;
	}
	return false;
}

/** True where a string is a value a test asserts: it lies in `expect`'s first argument, or in a matcher's arguments. */
function isAsserted(node: ts.Node): boolean {
	for (let child: ts.Node = node; !ts.isSourceFile(child.parent); child = child.parent) {
		const call = child.parent;
		if (!ts.isCallExpression(call) || !call.arguments.some((argument) => argument === child)) continue;
		if (isExpectCall(call) && call.arguments[0] === child) return true;
		if (MATCHERS.has(calleeName(call.expression) ?? "") && rootName(call.expression) === EXPECT) return true;
	}
	return false;
}

/** True where a string is a literal without substitutions that holds a JSON object or array, such as a fixture's event line. */
function isJson(node: TStringNode): boolean {
	if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return false;
	const text = node.text.trim();
	if (!text.startsWith("{") && !text.startsWith("[")) return false;
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}

/** The local function a call names, by its declaration in this file. */
function helperOf(argument: TArgument, facts: TSourceFacts): THelper | undefined {
	const name = ts.isIdentifier(argument.call.expression) ? argument.call.expression.text : undefined;
	return name === undefined ? undefined : facts.helpers.get(name);
}

/** True where a string is a fixture's record content or a fixture person's words, or a JSON value. */
function isData(node: TStringNode, facts: TSourceFacts): boolean {
	if (DATA_PROPERTIES.has(propertyOf(node) ?? "") || isJson(node)) return true;
	const argument = argumentOf(node, wraps);
	if (argument === undefined) return false;
	return DATA_CALLS.has(calleeName(argument.call.expression) ?? "") || (helperOf(argument, facts)?.data.has(argument.index) ?? false);
}

/** The test call whose title the string is. */
function testTitled(node: ts.Node): ts.CallExpression | ts.NewExpression | undefined {
	const argument = argumentOf(node, wraps);
	return argument !== undefined && argument.index === 0 && TEST_TITLE_CALL.test(rootName(argument.call.expression) ?? "") ? argument.call : undefined;
}

/** True where a string describes code: a test's title, or the message `expect` reports. */
function describesCode(node: ts.Node): boolean {
	const argument = argumentOf(node, wraps);
	return testTitled(node) !== undefined || (argument !== undefined && argument.index === 1 && isExpectCall(argument.call));
}

/** True where a test's title is the input its test passes, as a string literal of its own callback: `it("Given I test", () => dePolite("Given I test"))`. */
function titleQuotesInput(node: TStringNode): boolean {
	const call = testTitled(node);
	if (call === undefined || ts.isJsxText(node)) return false;
	const title = ts.isTemplateExpression(node) ? undefined : node.text;
	let quoted = false;
	const visit = (child: ts.Node): void => {
		if (quoted) return;
		if (child !== node && (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) && child.text === title) quoted = true;
		else ts.forEachChild(child, visit);
	};
	for (const argument of call.arguments?.slice(1) ?? []) visit(argument);
	return quoted;
}

/** In a test, a string is prose where it is a message a person reads (an error's, a step failure's, or a local helper's message) or a description. */
function proseInTest(node: ts.Node, facts: TSourceFacts): boolean {
	const argument = argumentOf(node, wraps);
	if (argument !== undefined && (isMessageCall(argument.call) || (helperOf(argument, facts)?.message.has(argument.index) ?? false))) return true;
	return propertyOf(node) === DESCRIPTION_PROPERTY;
}

function stringUse(node: TStringNode, facts: TSourceFacts): TStringUse {
	if (isCode(node)) return "code";
	if (isData(node, facts)) return "data";
	if (facts.featureText.has(node)) return "feature";
	if (isAsserted(node)) return "code";
	const property = facts.isFeature ? propertyOf(node, wrapsOrLists) : undefined;
	if (property !== undefined && !FEATURE_PROSE_PROPERTIES.has(property)) return "data";
	if (titleQuotesInput(node)) return "data";
	if (describesCode(node)) return "describes";
	return facts.isTest && !proseInTest(node, facts) ? "data" : "prose";
}

/** The identifier a message opens with: the message itself, or the first substitution of a template that opens with it. */
function openingIdentifier(message: ts.Expression): string | undefined {
	if (ts.isIdentifier(message)) return message.text;
	const first = ts.isTemplateExpression(message) && message.head.text === "" ? message.templateSpans[0]?.expression : undefined;
	return first !== undefined && ts.isIdentifier(first) ? first.text : undefined;
}

/**
 * Adds the identifiers a message call opens with to each function whose body holds the call: a parameter named there is
 * the message's text, as `within`'s `what` is.
 */
function readMessageNames(call: ts.CallExpression | ts.NewExpression, names: Map<ts.Node, Set<string>>): void {
	const opening = call.arguments?.flatMap((argument) => openingIdentifier(argument) ?? []) ?? [];
	if (opening.length === 0) return;
	for (let child: ts.Node = call; !ts.isSourceFile(child); child = child.parent) {
		const holder = child.parent;
		if (ts.isFunctionLike(holder) && "body" in holder && holder.body === child) {
			const held = names.get(holder) ?? new Set<string>();
			for (const name of opening) held.add(name);
			names.set(holder, held);
		}
	}
}

/**
 * A function the file declares, by the parameters whose argument is a message or a fixture's content. `messages` holds the
 * names that open its body's messages.
 */
function helperOfDeclaration(declaration: THelperDeclaration, messages: ReadonlySet<string> | undefined): THelper {
	const names = declaration.parameters.map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : ""));
	const indices = (holds: (name: string) => boolean) => new Set(names.flatMap((name, index) => (name !== "" && holds(name) ? [index] : [])));
	return { message: indices((name) => name === MESSAGE_PARAMETER || messages?.has(name) === true), data: indices((name) => DATA_PROPERTIES.has(name)) };
}

/** True where a variable is a feature file's export of its features or backgrounds. */
function isKirejiExport(declaration: ts.VariableDeclaration): boolean {
	const statement = declaration.parent.parent;
	const exported = ts.isVariableStatement(statement) && (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
	const named = ts.isIdentifier(declaration.name) && KIREJI_EXPORT_NAMES.has(declaration.name.text);
	return exported && (named || declaration.type?.getText().includes(KIREJI_EXPORT_TYPE) === true);
}

/** The lists of steps an export of features or backgrounds names by feature, wherever its object literal lies: `cond ? { name: [...] } : {}`. */
function kirejiSteps(node: ts.Node): ts.Node[] {
	if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap((property) => (ts.isPropertyAssignment(property) ? [property.initializer] : []));
	return node.getChildren().flatMap(kirejiSteps);
}

/** The feature text of an object literal that holds a feature's `path` and `content`: its content. */
function featureContent(node: ts.ObjectLiteralExpression): ts.Node | undefined {
	const named = (name: string) => node.properties.find((property) => property.name !== undefined && propertyName(property.name) === name);
	const content = named(FEATURE_CONTENT_PROPERTY);
	if (named(FEATURE_PATH_PROPERTY) === undefined || content === undefined) return undefined;
	if (ts.isPropertyAssignment(content)) return content.initializer;
	return ts.isShorthandPropertyAssignment(content) ? content.name : undefined;
}

/**
 * The strings a file holds as feature text, from the roots `readSource` finds: a unit test runner's first argument, the
 * `content` of a feature's `{ path, content }`, a feature file's exported features and backgrounds and the statements its
 * builders take, and every declaration of a variable they name. A message inside them is a message, so it isn't feature text.
 */
function featureTextFrom(roots: readonly ts.Node[], declared: ReadonlyMap<string, readonly ts.Expression[]>): Set<ts.Node> {
	const texts = new Set<ts.Node>();
	const followed = new Set<ts.Node>();
	const collect = (node: ts.Node): void => {
		if (isStringNode(node)) texts.add(node);
		if (ts.isIdentifier(node)) {
			for (const initializer of declared.get(node.text) ?? []) {
				if (followed.has(initializer)) continue;
				followed.add(initializer);
				collect(initializer);
			}
		} else if (ts.isShorthandPropertyAssignment(node)) {
			if (node.name.text === FEATURE_CONTENT_PROPERTY) collect(node.name);
		} else if (ts.isPropertyAssignment(node)) {
			if (propertyName(node.name) === FEATURE_CONTENT_PROPERTY) collect(node.initializer);
		} else if (!isMessageCall(node) && !ts.isThrowStatement(node)) ts.forEachChild(node, collect);
	};
	for (const root of roots) collect(root);
	return texts;
}

/** The outcome a waypoint line declares, without its proof or the domain it resolves. */
function waypointOutcome(declared: string): string {
	const resolves = WAYPOINT_RESOLVES.exec(declared)?.[1];
	if (resolves !== undefined) return resolves.trim();
	const proof = declared.lastIndexOf(WAYPOINT_PROOF);
	return (proof === -1 ? declared : declared.slice(0, proof)).trim();
}

/** A feature line that invokes an activity or a waypoint the feature text declares, or the heading of an activity whose name a waypoint declares. */
function invokesDeclared(lines: readonly string[]): (line: string) => boolean {
	const activities = new Set(lines.flatMap((line) => ACTIVITY_LINE.exec(line)?.[1]?.trim() ?? []));
	const waypoints = lines.flatMap((line) => {
		const declared = WAYPOINT_LINE.exec(line)?.[1];
		if (declared === undefined) return [];
		const parts = waypointOutcome(declared)
			.split(WAYPOINT_PARAMETER)
			.map((part) => part.replace(REGEXP_SPECIAL, "\\$&"));
		return [new RegExp(`^${parts.join(".+")}$`)];
	});
	const isOutcome = (text: string) => waypoints.some((waypoint) => waypoint.test(text));
	return (line) => {
		const activity = ACTIVITY_LINE.exec(line)?.[1]?.trim();
		return activities.has(line) || isOutcome(line) || (activity !== undefined && isOutcome(activity));
	};
}

/** True for a feature line the resolver reads as prose. */
function isFeatureProse(text: string): boolean {
	return text.includes(" ") && (FEATURE_SENTENCE.test(text) || FEATURE_HEADING.test(text) || FEATURE_MARKUP.test(text));
}

/** Feature text as prose a line at a time: each line the resolver reads as prose, and each quoted argument of a step that holds a sentence. */
function featureBlocks(lines: readonly TLine[], invokes: (line: string) => boolean): TProseBlock[] {
	return lines.flatMap(({ line, text }): TProseBlock[] => {
		if (text === "" || invokes(text)) return [];
		if (isFeatureProse(text)) return [{ kind: "string", lines: [{ line, text }], instructs: true }];
		return [...text.matchAll(QUOTED_ARGUMENT)].flatMap(([, argument]): TProseBlock[] =>
			argument !== undefined && QUOTED_SENTENCE.test(argument) ? [{ kind: "string", lines: [{ line, text: argument }], instructs: true }] : [],
		);
	});
}

function featureFileBlocks(text: string): TProseBlock[] {
	const lines = text.split(LINE_BREAK).map((line, index) => ({ line: index + 1, text: line.trim() }));
	return featureBlocks(lines, invokesDeclared(lines.map(({ text }) => text)));
}

function isCssTemplate(node: ts.Node): boolean {
	return ts.isTaggedTemplateExpression(node.parent) && node.parent.template === node && ts.isIdentifier(node.parent.tag) && node.parent.tag.text === CSS_TAG;
}

/** A stylesheet's comments, each read as a comment by the source line on which it starts. */
function cssCommentBlocks(source: ts.SourceFile, node: ts.Node): TProseBlock[] {
	const start = node.getStart(source);
	return [...node.getText(source).matchAll(BLOCK_COMMENT)].flatMap((found) =>
		commentParagraphs(blockCommentLines(found[0], source.getLineAndCharacterOfPosition(start + found.index).line + 1)),
	);
}

/**
 * A string with a space is prose where its position holds prose (`stringUse`). Feature text is prose a line at a time, and
 * a stylesheet's prose is its comments.
 */
function stringBlocks(source: ts.SourceFile, { strings, facts }: TSourceRead): TProseBlock[] {
	const inPlace = new Set<ts.Node>();
	const css: TProseBlock[] = [];
	const literals: { lines: TLine[]; use: TStringUse }[] = [];
	for (const node of strings) {
		if (inPlace.has(node)) continue;
		if (isCssTemplate(node)) css.push(...cssCommentBlocks(source, node));
		else {
			const use = stringUse(node, facts);
			if (use !== "code" && use !== "data") literals.push({ lines: stringLines(source, node, inPlace), use });
		}
	}
	const invokes = invokesDeclared(literals.flatMap(({ lines, use }) => (use === "feature" ? lines.map(({ text }) => text) : [])));
	return [
		...css,
		...literals.flatMap(({ lines, use }): TProseBlock[] => {
			if (use === "feature") return featureBlocks(lines, invokes);
			return lines.some(({ text }) => text.includes(" ")) ? [{ kind: "string", lines: unquoted(lines), instructs: use !== "describes" }] : [];
		}),
	];
}
