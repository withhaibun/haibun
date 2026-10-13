/**
 * The step lines a kireji document writes: each line of a string a variable typed `TKirejiStep` or `TKirejiExport` holds,
 * or a value cast to `TKirejiStep`, holds. An empty line and a line that starts with `#` aren't steps.
 */
import ts from "typescript";
import { KIREJI_TYPE_NAMES } from "../domains/lsp.js";

/** A step line of a kireji document: its text and the offset in the document where the text starts. */
export type TKirejiLine = { text: string; offset: number };

const [STEP_TYPE, EXPORT_TYPE] = KIREJI_TYPE_NAMES;
const COMMENT = "#";
const LINE_BREAK = /\r\n|\n|\r/g;

type TStringNode = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression;
const isStringNode = (node: ts.Node): node is TStringNode => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);

/** Each step line of a string node: its quotes are left out, and each line break ends a line. */
function linesOf(node: TStringNode, source: ts.SourceFile): TKirejiLine[] {
	const written = node.getText(source);
	if (written.length < 2) return [];
	const inner = written.slice(1, -1);
	const opens = node.getStart(source) + 1;
	const found: TKirejiLine[] = [];
	let at = 0;
	for (const lineBreak of [...inner.matchAll(LINE_BREAK), undefined]) {
		const end = lineBreak === undefined ? inner.length : lineBreak.index;
		const line = inner.slice(at, end);
		const text = line.trim();
		if (text.length > 0 && !text.startsWith(COMMENT)) found.push({ text, offset: opens + at + line.indexOf(text) });
		if (lineBreak !== undefined) at = end + lineBreak[0].length;
	}
	return found;
}

/** The step lines of a value: a string's lines, or each string's lines in an array. */
function valueLines(node: ts.Node, source: ts.SourceFile): TKirejiLine[] {
	if (ts.isArrayLiteralExpression(node)) return node.elements.filter(isStringNode).flatMap((element) => linesOf(element, source));
	return isStringNode(node) ? linesOf(node, source) : [];
}

/** The step lines of a kireji document, in the order it writes them. */
export function kirejiLines(path: string, text: string): TKirejiLine[] {
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const found: TKirejiLine[] = [];
	const visit = (node: ts.Node): void => {
		// A variable typed `TKirejiStep[]` is an array type rather than a type reference, so its declaration isn't read.
		if (ts.isVariableDeclaration(node) && node.type && ts.isTypeReferenceNode(node.type) && node.initializer) {
			const typeName = node.type.typeName.getText(source);
			if (typeName.includes(STEP_TYPE)) found.push(...valueLines(node.initializer, source));
			else if (typeName.endsWith(EXPORT_TYPE) && ts.isObjectLiteralExpression(node.initializer))
				for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property)) found.push(...valueLines(property.initializer, source));
		}
		if (ts.isAsExpression(node) && node.type.getText(source).includes(STEP_TYPE)) found.push(...valueLines(node.expression, source));
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}
