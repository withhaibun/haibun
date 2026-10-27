/**
 * Five rules, read from a repository's files. A call reaches step dispatch or a step's action only
 * through the logic engine's prover, so every surface has one path (one path). The logic engine reads the store only through
 * its read request's reader (one read). A file doesn't name a concept by a synonym the vocabulary table removes (one
 * vocabulary), name an application built on the repository (downstream names), or state a safety check over a class
 * expression as an absence (positive checks).
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import type { TFound } from "./baseline.js";
import { filesUnder } from "./prose-rules.js";
import { lineOf, type TSources } from "./repository-files.js";
import { itemAt } from "../domains/item-at.js";

/** The files that implement the call the prover performs: dispatch, the registry's handler, and the prover itself. */
const PROVER_FILES = [/lib\/actuality\/pipelines\/step-dispatch\.ts$/, /lib\/steps\/pipelines\/step-registry\.ts$/, /modules\/logic\/src\/pipelines\/prove\.ts$/];
export const REACHES_DISPATCH = "reaches step dispatch outside the logic engine's prover";
export const REACHES_ACTION = "calls a step's action outside the logic engine's prover";

/** Each call outside the prover's files of `dispatchStep`, of a registered step's handler, or of a step's action. */
export function onePathFindings(sources: TSources): TFound[] {
	return [...sources]
		.filter(([file]) => !PROVER_FILES.some((pattern) => pattern.test(file)))
		.flatMap(([file, source]) => {
			const found: TFound[] = [];
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node)) {
					const callee = node.expression;
					if (ts.isIdentifier(callee) && callee.text === "dispatchStep") found.push({ file, finding: REACHES_DISPATCH, line: lineOf(node) });
					if (ts.isPropertyAccessExpression(callee) && node.arguments.length === 2) {
						const named = callee.name.text;
						if (named === "handler" || (named === "action" && /step/i.test(callee.expression.getText(source)))) found.push({ file, finding: REACHES_ACTION, line: lineOf(node) });
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(source);
			return found;
		});
}

/** The logic engine's source, and its reader, the one file of it that reads the store. */
const LOGIC_SOURCE = /^modules\/logic\/src\//;
const LOGIC_READER = /^modules\/logic\/src\/pipelines\/reads\.ts$/;
/** The store's reads by the number of arguments each takes, and the modules of core's reads of records. */
const STORE_READS: Record<string, (count: number) => boolean> = {
	query: (count) => count === 1,
	get: (count) => count >= 2,
	all: (count) => count === 0,
	readRecords: () => true,
	distinctPropertyValues: () => true,
	density: () => true,
	getClusteredQuads: () => true,
};
const RECORD_READ_MODULES = /\/records\/pipelines\/(record-reads|facts)\.js$/;
export const READS_STORE = "reads the store outside the logic engine's reader";

/** Each read of the store in the logic engine's source outside its reader: a call of a store's read, or an import of core's reads of records. */
export function oneReadFindings(sources: TSources): TFound[] {
	return [...sources]
		.filter(([file]) => LOGIC_SOURCE.test(file) && !LOGIC_READER.test(file))
		.flatMap(([file, source]) => {
			const found: TFound[] = [];
			const visit = (node: ts.Node): void => {
				if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && RECORD_READ_MODULES.test(node.moduleSpecifier.text))
					found.push({ file, finding: READS_STORE, line: lineOf(node) });
				if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
					const reads = STORE_READS[node.expression.name.text];
					if (reads?.(node.arguments.length) === true) found.push({ file, finding: READS_STORE, line: lineOf(node) });
				}
				ts.forEachChild(node, visit);
			};
			visit(source);
			return found;
		});
}

/** The heading of the vocabulary table in a document. */
const VOCABULARY_HEADING = "## One vocabulary";
/** A synonym the table's last column removes, written in backticks. */
const SYNONYM = /`([^`]+)`/g;

/** The vocabulary table's section of a document. */
function tableSection(markdown: string): string {
	const at = markdown.indexOf(VOCABULARY_HEADING);
	if (at < 0) throw new Error(`the document doesn't hold a "${VOCABULARY_HEADING}" section with the vocabulary table`);
	return itemAt(markdown.slice(at).split("\n## "), 0);
}

/** Each term of the vocabulary table with the synonyms it removes, from the document that holds the table. */
export function vocabularyOf(markdown: string): { term: string; removed: string[] }[] {
	return tableSection(markdown)
		.split("\n")
		.filter((line) => line.startsWith("|") && !line.startsWith("| Concept") && !line.startsWith("| ---"))
		.map((line) => {
			const cells = line.split("|").map((cell) => cell.trim());
			return { term: itemAt(cells, 2), removed: [...itemAt(cells, 4).matchAll(SYNONYM)].map((match) => itemAt(match, 1)) };
		});
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A word or phrase as a whole word, in any case. */
const wholeWord = (text: string): RegExp => new RegExp(`(?<![\\w-])${escaped(text)}(?![\\w-])`, "gi");
type TWordFinding = { pattern: RegExp; finding: string };

/** Each match of a word's pattern in the files under the roots but those `exclude` leaves out, each text as `read` returns it. */
function wordFindings(
	repository: string,
	roots: readonly string[],
	exclude: readonly RegExp[],
	words: readonly TWordFinding[],
	read: (file: string, text: string) => string,
): TFound[] {
	const files = roots.flatMap((root) => filesUnder(repository, join(repository, root))).map((file) => relative(repository, file).split(sep).join("/"));
	return [...new Set(files)]
		.filter((file) => !exclude.some((pattern) => pattern.test(file)))
		.flatMap((file) =>
			read(file, readFileSync(join(repository, file), "utf8"))
				.split("\n")
				.flatMap((line, at) => words.flatMap(({ pattern, finding }) => [...line.matchAll(pattern)].map(() => ({ file, finding, line: at + 1 })))),
		);
}

/** Each use of a removed synonym as a whole word in the files under the roots, apart from the vocabulary table itself. */
export function vocabularyFindings(repository: string, roots: readonly string[], tableFile: string, exclude: readonly RegExp[]): TFound[] {
	const table = vocabularyOf(readFileSync(join(repository, tableFile), "utf8"));
	const synonyms = table.flatMap(({ term, removed }) => removed.map((synonym) => ({ pattern: wholeWord(synonym), finding: `names ${term} as ${synonym}` })));
	return wordFindings(repository, roots, exclude, synonyms, (file, text) => (file === tableFile ? text.replace(tableSection(text), "") : text));
}

/** Each use of a downstream application's name as a whole word in the files under the roots, apart from the file that states
 *  the names. A library doesn't name what is built on it. */
export function downstreamNameFindings(
	repository: string,
	roots: readonly string[],
	{ names, statedIn }: { names: readonly string[]; statedIn: string },
	exclude: readonly RegExp[],
): TFound[] {
	const words = names.map((name) => ({ pattern: wholeWord(name), finding: `names the downstream ${name}` }));
	return wordFindings(repository, roots, [...exclude, new RegExp(`^${escaped(statedIn)}$`)], words, (_file, text) => text);
}

/** A safety check stated as an absence over a class expression: a count of its members held to zero, or a membership negated.
 *  The open world doesn't prove absence, so such a check passes where a fact is missing. */
const ABSENCE_CHECKS: readonly TWordFinding[] = [
	{ pattern: /\b(?:exactly|at most) 0,?\s+individuals of\b/gi, finding: "states a safety check as an absence of a class expression's members" },
	{ pattern: /\bnot individual \S+ is a\b/gi, finding: "states a safety check as a negated membership" },
];

/** Each safety check over a class expression stated as an absence, in the files under the roots. A check proves containment instead. */
export function absenceCheckFindings(repository: string, roots: readonly string[], exclude: readonly RegExp[]): TFound[] {
	return wordFindings(repository, roots, exclude, ABSENCE_CHECKS, (_file, text) => text);
}
