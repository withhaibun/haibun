/**
 * Each pane kind's view leads on from every empty, unavailable or failed state it renders. A view renders such a state through
 * `empty-state.ts`, whose state requires what it leads on to (`TLeadsOn`): a reference, a control, or a refusal with its remedy.
 * The rule reads the views shu declares, each element a pane kind opens and each a declaration names as the view of its
 * domain, which a pane chooses at run time, and the modules of its directory that the element imports, and finds an empty
 * state's markup written apart from that pathway.
 */
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { importsOf, lineOf, parsedSource, RELATIVE, sourceFiles, TEST_MODULE } from "@haibun/core/lib/test/repository-files.js";
import { SHU_TAG } from "./domains/elements.js";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const PANE_KINDS_FILE = "modules/shu/src/page/derivations/pane-kinds.ts";
/** The sources whose declarations name the view of a domain. */
const DECLARING = ["modules/shu/src", "modules/core/src"];
/** The page's directories of views. */
const VIEWS = /^modules\/shu\/src\/page\/(.*\/)?components\//;
/** The views the rule reads. The graph presenter's views draw a scene, which its own bundle holds. */
const READ_VIEWS = /^modules\/shu\/src\/page\/(client-cache\/)?components\//;
/** The modules that render an empty state's markup: the pathway itself, and the waiting a read under way states. */
const PATHWAY = new Set(["modules/shu/src/page/components/empty-state.ts", "modules/shu/src/page/components/load-renders.ts"]);
/** An empty state's markup. */
const EMPTY_MARKUP = /class="empty\b/;
/** The tag of a view's templates. */
const HTML_TAG = "html";

/** The static text of a template. */
const staticText = (template: ts.TemplateLiteral): string =>
	ts.isNoSubstitutionTemplateLiteral(template) ? template.text : [template.head.text, ...template.templateSpans.map((span) => span.literal.text)].join("");

/** Each template in `source` that writes an empty state's markup. */
function bypasses(source: ts.SourceFile): { line: number; text: string }[] {
	const found: { line: number; text: string }[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === HTML_TAG && EMPTY_MARKUP.test(staticText(node.template)))
			found.push({ line: lineOf(node), text: staticText(node.template).replace(/\s+/g, " ").trim() });
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** The key in SHU_TAG of an element's tag. */
const keyOfTag = (tag: string): string | undefined => Object.entries(SHU_TAG).find(([, value]) => value === tag)?.[0];

/** The keys of SHU_TAG that the pane kinds open, and that a declaration names as the view of a domain (`component:`). */
function paneTags(): Set<string> {
	const tags = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "SHU_TAG") tags.add(node.name.text);
		ts.forEachChild(node, visit);
	};
	visit(parsedSource(REPOSITORY, PANE_KINDS_FILE));
	const declares = (node: ts.Node): void => {
		if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "component") {
			const named = node.initializer;
			const key = ts.isStringLiteral(named) ? keyOfTag(named.text) : ts.isPropertyAccessExpression(named) && named.expression.getText() === "SHU_TAG" ? named.name.text : undefined;
			if (key !== undefined) tags.add(key);
		}
		ts.forEachChild(node, declares);
	};
	const declaring = sourceFiles(REPOSITORY, DECLARING).filter(
		(file) => !TEST_MODULE.test(file) && !VIEWS.test(file) && readFileSync(join(REPOSITORY, file), "utf-8").includes("component:"),
	);
	for (const file of declaring) declares(parsedSource(REPOSITORY, file));
	return tags;
}

/** The page's view sources, apart from their tests. */
const componentFiles = (): string[] => sourceFiles(REPOSITORY, ["modules/shu/src/page"]).filter((file) => VIEWS.test(file) && !TEST_MODULE.test(file));

/** The file that defines each element a pane kind opens, by its key in SHU_TAG. */
function paneViews(tags: ReadonlySet<string>): Map<string, string> {
	const defined = componentFiles().flatMap((file) =>
		[...readFileSync(join(REPOSITORY, file), "utf-8").matchAll(/defineElement\(SHU_TAG\.(\w+),/g)].flatMap(([, key]) => (key === undefined ? [] : [[key, file] as const])),
	);
	return new Map(defined.filter(([key]) => tags.has(key)));
}

/** The file of each element a pane kind opens, and the modules of its directory that it imports. */
function paneViewFiles(): string[] {
	const views = [...paneViews(paneTags()).values()];
	const components = componentFiles();
	const imported = views.flatMap((file) =>
		importsOf(parsedSource(REPOSITORY, file))
			.filter(({ specifier, typeOnly }) => !typeOnly && RELATIVE.test(specifier))
			.map(({ specifier }) => posix.join(dirname(file), specifier).replace(/\.js$/, ".ts")),
	);
	return [...new Set([...views, ...imported.filter((file) => components.includes(file))])];
}

describe("pane kinds' views", () => {
	it("finds the element of every tag a pane kind opens or a declaration names", () => {
		const tags = paneTags();
		const views = paneViews(tags);
		expect([...tags].filter((key) => !views.has(key))).toEqual([]);
	});

	it("render each empty, unavailable or failed state through the pathway that requires what it leads on to", () => {
		const found = paneViewFiles()
			.filter((file) => READ_VIEWS.test(file) && !PATHWAY.has(file))
			.flatMap((file) => bypasses(parsedSource(REPOSITORY, file)).map(({ line, text }) => `${file}:${line} writes "${text}"`));
		expect(found, "render the state with emptyState, emptyOrLoading or unavailableOrEmpty, and state what it leads on to").toEqual([]);
	});

	it("reads a template that writes an empty state's markup, with or without a substitution, as one that bypasses the pathway", () => {
		const source = ts.createSourceFile(
			"view.ts",
			[
				'const a = html`<div class="empty">Nothing was found.</div>`;',
				'const b = html`<div class="empty unavailable">${why}</div>`;',
				"const c = emptyState({ message, next });",
			].join("\n"),
			ts.ScriptTarget.Latest,
			true,
		);
		expect(bypasses(source).map(({ line }) => line)).toEqual([1, 2]);
	});
});
