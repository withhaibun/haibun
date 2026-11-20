/**
 * The string literals a repository's source writes in place of a constant, read through the TypeScript parser.
 *
 * A compact IRI (`prefix:name`) of a vocabulary that `vocabularies.ts` declares is named through the constant that module
 * declares for it, so each IRI is written once for every module that names it.
 *
 * A term that a file writes more than once is named through a constant, so the file states it once. A term is a literal
 * that reads as a word, or as words joined by `.`, `:`, `_` or `-`. A module specifier, a literal type and the name of a
 * type that `typeof` returns aren't terms: the language states each of them.
 */
import ts from "typescript";
import { NAMESPACE } from "../domains/vocabularies.js";
import type { TFound } from "./baseline.js";
import { lineOf, type TSources } from "./repository-files.js";

/** The module that declares each compact IRI's constant, whose literals are the constants' values. */
const VOCABULARIES = /(?:^|\/)lib\/domains\/vocabularies\.ts$/;
/** The prefixes whose compact IRIs a string's spelling doesn't distinguish from other strings. A DID begins `did:`, as a term of
 *  the DID vocabulary does, so a DID's method, such as `did:web`, reads as a compact IRI. */
const UNREADABLE_PREFIXES: ReadonlySet<string> = new Set(["did"]);
/** A literal that is a compact IRI of a vocabulary `vocabularies.ts` declares. */
const COMPACT_IRI = new RegExp(
	`^(?:${Object.keys(NAMESPACE)
		.filter((prefix) => !UNREADABLE_PREFIXES.has(prefix))
		.join("|")}):[A-Za-z][\\w-]*$`,
);
/** A literal that reads as a term. */
const TERM = /^[A-Za-z][\w.:-]{2,}$/;
/** The names of the types `typeof` returns, which a comparison with it writes as the language states them. */
const TYPEOF_NAMES: ReadonlySet<string> = new Set(["string", "number", "boolean", "function", "object", "undefined", "bigint", "symbol"]);

export const WRITES_COMPACT_IRI = "writes a compact IRI that vocabularies.ts declares a constant for";
export const REPEATS_TERM = "writes a term more than once in place of a constant";

/** A string literal of a source, at its line. */
type TLiteral = { readonly text: string; readonly line: number };

/** Whether a literal is a module specifier, a literal type, or the name of a type that `typeof` returns in a comparison. */
function statedByTheLanguage(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): boolean {
	const { parent } = node;
	if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) || ts.isLiteralTypeNode(parent)) return true;
	if (ts.isModuleDeclaration(parent) || ts.isImportTypeNode(parent.parent)) return true;
	if (ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(parent.expression) && parent.expression.text === "require")))
		return true;
	if (ts.isBinaryExpression(parent) && TYPEOF_NAMES.has(node.text)) return ts.isTypeOfExpression(parent.left) || ts.isTypeOfExpression(parent.right);
	return false;
}

/** The string literals of a source that the language doesn't state. */
function literalsOf(source: ts.SourceFile): TLiteral[] {
	const found: TLiteral[] = [];
	const visit = (node: ts.Node): void => {
		if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !statedByTheLanguage(node)) found.push({ text: node.text, line: lineOf(node) });
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** Each compact IRI a source writes as a literal, apart from `vocabularies.ts`, which declares their constants. */
export function compactIriFindings(sources: TSources): TFound[] {
	return [...sources].flatMap(([file, source]) =>
		VOCABULARIES.test(file) ? [] : literalsOf(source).flatMap(({ text, line }) => (COMPACT_IRI.test(text) ? [{ file, finding: `${WRITES_COMPACT_IRI}: ${text}`, line }] : [])),
	);
}

/** Each term a source writes more than once, at each place after the first. */
export function repeatedTermFindings(sources: TSources): TFound[] {
	return [...sources].flatMap(([file, source]) => {
		const seen = new Set<string>();
		return literalsOf(source).flatMap(({ text, line }) => {
			if (!TERM.test(text)) return [];
			if (!seen.has(text)) {
				seen.add(text);
				return [];
			}
			return [{ file, finding: REPEATS_TERM, line }];
		});
	});
}
