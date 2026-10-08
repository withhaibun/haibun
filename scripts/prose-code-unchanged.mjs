#!/usr/bin/env node
// Checks that a prose rewrite changed only prose: compares each TypeScript file's tokens with HEAD's, leaving out comments
// and the contents of string and template literals. In a test file a regular expression's contents are left out too, since
// a test's regular expression asserts a message's text. Exits 1 naming each file whose code changed or that HEAD doesn't hold.
//
// Usage: node scripts/prose-code-unchanged.mjs <repository root> <repository-relative file>...
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const USAGE = "usage: node scripts/prose-code-unchanged.mjs <repository root> <repository-relative file>...";
const [repo, ...files] = process.argv.slice(2);
if (!repo || files.length === 0) throw new Error(USAGE);

const LITERALS = new Set([
	ts.SyntaxKind.StringLiteral,
	ts.SyntaxKind.NoSubstitutionTemplateLiteral,
	ts.SyntaxKind.TemplateHead,
	ts.SyntaxKind.TemplateMiddle,
	ts.SyntaxKind.TemplateTail,
	ts.SyntaxKind.JsxText,
]);
const isJsDoc = (node) => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

const TEST_FILE = /\.test(-fake)?\.tsx?$/;

/** The file's tokens in order, each literal by its kind alone. */
function codeTokens(text, name) {
	const literals = TEST_FILE.test(name) ? new Set([...LITERALS, ts.SyntaxKind.RegularExpressionLiteral]) : LITERALS;
	const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const tokens = [];
	const visit = (node) => {
		if (isJsDoc(node)) return;
		const children = node.getChildren(source);
		if (children.length === 0) {
			tokens.push(literals.has(node.kind) ? ts.SyntaxKind[node.kind] : `${ts.SyntaxKind[node.kind]} ${node.getText(source)}`);
			return;
		}
		for (const child of children) visit(child);
	};
	visit(source);
	return tokens;
}

let changed = 0;
for (const file of files.filter((name) => /\.tsx?$/.test(name))) {
	let head;
	try {
		head = execFileSync("git", ["-C", repo, "show", `HEAD:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	} catch {
		console.log(`${file}: HEAD doesn't hold this file`);
		changed++;
		continue;
	}
	const before = codeTokens(head, file);
	const after = codeTokens(readFileSync(join(repo, file), "utf8"), file);
	const at = before.findIndex((token, i) => token !== after[i]);
	if (at === -1 && before.length === after.length) continue;
	const index = at === -1 ? Math.min(before.length, after.length) : at;
	console.log(`${file}: code changed at token ${index}: HEAD [${before.slice(index, index + 6).join(" | ")}] now [${after.slice(index, index + 6).join(" | ")}]`);
	changed++;
}
process.exit(changed > 0 ? 1 : 0);
