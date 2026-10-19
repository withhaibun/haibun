/**
 * Two rules of the logic engine, read from a repository's files. A call reaches step dispatch or a step's action only
 * through the logic engine's prover, so every surface has one path (one path). A file doesn't name a concept by a synonym
 * the vocabulary table removes (one vocabulary).
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

/** Each use of a removed synonym as a whole word in the files under the roots, apart from the vocabulary table itself. */
export function vocabularyFindings(repository: string, roots: readonly string[], tableFile: string, exclude: readonly RegExp[]): TFound[] {
	const table = vocabularyOf(readFileSync(join(repository, tableFile), "utf8"));
	const synonyms = table.flatMap(({ term, removed }) => removed.map((synonym) => ({ term, synonym, pattern: new RegExp(`(?<![\\w-])${escaped(synonym)}(?![\\w-])`, "gi") })));
	const files = roots.flatMap((root) => filesUnder(join(repository, root))).map((file) => relative(repository, file).split(sep).join("/"));
	return [...new Set(files)]
		.filter((file) => !exclude.some((pattern) => pattern.test(file)))
		.flatMap((file) => {
			const text = readFileSync(join(repository, file), "utf8");
			const read = file === tableFile ? text.replace(tableSection(text), "") : text;
			return read
				.split("\n")
				.flatMap((line, at) =>
					synonyms.flatMap(({ term, synonym, pattern }) => [...line.matchAll(pattern)].map(() => ({ file, finding: `names ${term} as ${synonym}`, line: at + 1 }))),
				);
		});
}
