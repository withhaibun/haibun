/**
 * Each pane kind's view leads on from every state it renders. A view chooses what to render: one outcome of a read, or one
 * branch of a choice between two things to show. A choice that renders only text, without a link, a control or interpolated
 * content, is a dead end: an empty state that states what isn't there without a next step. A choice between content and
 * an empty view is an optional section, not a state, so it isn't one. A component pane's view is the component its pane names,
 * which the deployment declares, so the rule reads the views of the kinds whose view is shu's own: each element a pane kind
 * opens, and the modules in its directory that the element imports.
 */
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { importsOf, lineOf, parsedSource, RELATIVE, sourceFiles } from "@haibun/core/lib/test/repository-files.js";
import { LOAD_STATUS } from "./page/domains/load.js";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const PANE_KINDS_FILE = "modules/shu/src/page/derivations/pane-kinds.ts";
const COMPONENTS = "modules/shu/src/page/components";
/** What a template holds that leads on: a link, a reference, a control, a refusal with its remedy, a read under way, a table
 *  whose rows open records, or a slot a presenter fills. */
const LEADS_ON = /<(a|button|input|select|shu-ref|shu-refusal|shu-spinner|shu-copy-button|shu-result-table|slot)[\s>]|@click=/;
/** The outcomes of a read a view renders, each a state of the view, by the names a load's renders take. */
const READ_OUTCOMES = new Set<string>(Object.values(LOAD_STATUS));
/** The tag of a view's templates. */
const HTML_TAG = "html";

/** The expression a node stands for, through parentheses and assertions. */
const unwrapped = (node: ts.Node): ts.Node => (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) ? unwrapped(node.expression) : node);
/** The node a node is part of, through parentheses and assertions. */
function outer(node: ts.Node): { at: ts.Node; parent: ts.Node } {
	const parent = node.parent;
	return ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent) ? outer(parent) : { at: node, parent };
}
/** Whether an expression renders an empty view: an empty string or template, lit's empty value, `undefined` or `null`. */
function rendersNothing(node: ts.Node): boolean {
	const expression = unwrapped(node);
	if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text.trim() === "";
	if (ts.isTaggedTemplateExpression(expression)) return ts.isNoSubstitutionTemplateLiteral(expression.template) && expression.template.text.trim() === "";
	if (ts.isIdentifier(expression)) return expression.text === "nothing" || expression.text === "undefined";
	return expression.kind === ts.SyntaxKind.NullKeyword;
}
/** The function that holds a return statement. */
const functionOf = (node: ts.Node): ts.FunctionLikeDeclaration | undefined =>
	ts.isFunctionLike(node) ? (node as ts.FunctionLikeDeclaration) : node.parent ? functionOf(node.parent) : undefined;
/** The expressions a function returns, apart from those of the functions it holds. */
function returnsOf(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
	const returned: ts.Expression[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
		if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
	};
	if (fn.body) ts.forEachChild(fn.body, visit);
	return returned;
}

/** Whether a template is a state its view renders: one outcome of a read, one of the things a function returns, or one branch
 *  of a choice whose other branch renders something. */
function isAState(template: ts.TaggedTemplateExpression): boolean {
	const { at, parent } = outer(template);
	if (ts.isConditionalExpression(parent)) return !rendersNothing(at === parent.whenTrue ? parent.whenFalse : parent.whenTrue);
	const fn = ts.isArrowFunction(parent) && parent.body === at ? parent : ts.isReturnStatement(parent) ? functionOf(parent) : undefined;
	if (fn === undefined) return false;
	const assigned = fn.parent;
	if (ts.isPropertyAssignment(assigned) && ts.isIdentifier(assigned.name) && READ_OUTCOMES.has(assigned.name.text)) return true;
	return ts.isReturnStatement(parent) && returnsOf(fn).filter((returned) => !rendersNothing(returned)).length > 1;
}

/** Each template in `source` that renders a state as text alone, without a link, a control or interpolated content. */
function deadEnds(source: ts.SourceFile): { line: number; text: string }[] {
	const found: { line: number; text: string }[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === HTML_TAG && ts.isNoSubstitutionTemplateLiteral(node.template)) {
			const text = node.template.text;
			if (/\p{L}/u.test(text) && !LEADS_ON.test(text) && isAState(node))
				found.push({
					line: lineOf(node),
					text: text
						.replace(/<[^>]*>/g, " ")
						.replace(/\s+/g, " ")
						.trim(),
				});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** The keys of SHU_TAG that the pane kinds open. */
function paneTags(): Set<string> {
	const tags = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "SHU_TAG") tags.add(node.name.text);
		ts.forEachChild(node, visit);
	};
	visit(parsedSource(REPOSITORY, PANE_KINDS_FILE));
	return tags;
}

/** The components directory's sources, apart from its tests. */
const componentFiles = (): string[] => sourceFiles(REPOSITORY, [COMPONENTS]);

/** The file that defines each element a pane kind opens, by its key in SHU_TAG. */
function paneViews(): Map<string, string> {
	const tags = paneTags();
	const defined = componentFiles().flatMap((file) =>
		[...readFileSync(join(REPOSITORY, file), "utf-8").matchAll(/defineElement\(SHU_TAG\.(\w+),/g)].flatMap(([, key]) => (key === undefined ? [] : [[key, file] as const])),
	);
	return new Map(defined.filter(([key]) => tags.has(key)));
}

/** The file of each element a pane kind opens, and the modules of its directory that it imports. */
function paneViewFiles(): string[] {
	const views = [...paneViews().values()];
	const components = componentFiles();
	const imported = views.flatMap((file) =>
		importsOf(parsedSource(REPOSITORY, file))
			.filter(({ specifier, typeOnly }) => !typeOnly && RELATIVE.test(specifier))
			.map(({ specifier }) => posix.join(dirname(file), specifier).replace(/\.js$/, ".ts")),
	);
	return [...new Set([...views, ...imported.filter((file) => components.includes(file))])];
}

describe("pane kinds' views", () => {
	it("finds the element of every tag a pane kind opens", () => {
		expect([...paneTags()].filter((key) => !paneViews().has(key))).toEqual([]);
	});

	it("lead on from every state they render", () => {
		const found = paneViewFiles().flatMap((file) => deadEnds(parsedSource(REPOSITORY, file)).map(({ line, text }) => `${file}:${line} renders "${text}"`));
		expect(found, "state what the view leads to: link the record, step or action it is about, or offer the control that moves on").toEqual([]);
	});

	it("reads a state rendered as text alone as a dead end, and an optional section or a state with a link as leading on", () => {
		const source = ts.createSourceFile(
			"view.ts",
			[
				"const a = (items) => (items.length ? html`<ul>${items}</ul>` : html`<p>Nothing was found.</p>`);",
				"const b = (on) => (on ? html`<p>A note.</p>` : nothing);",
				"const c = (items) => (items.length ? html`<ul>${items}</ul>` : html`<p>Nothing was found. <a href='/'>Start again</a></p>`);",
				"load.render({ pending: () => html`<span>Loading…</span>`, completed: () => html`<shu-result-table></shu-result-table>` });",
			].join("\n"),
			ts.ScriptTarget.Latest,
			true,
		);
		expect(deadEnds(source)).toEqual([
			{ line: 1, text: "Nothing was found." },
			{ line: 4, text: "Loading…" },
		]);
	});
});
