/**
 * The files of a repository a check reads under its roots, by their paths from the repository root. A file git ignores
 * isn't read, since it isn't part of what a commit holds.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import * as ts from "typescript";
import { z } from "zod";

/** A test module: a `*.test.ts` file, a `*.test-fake.ts` file, or a file under a `test/` directory. */
export const TEST_MODULE = /(\.test|\.test-fake)\.tsx?$|(^|\/)test\//;
const SOURCE = /\.tsx?$/;
const DECLARATION = /\.d\.ts$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "build", "build-local", "build-firefox", "dist", "capture", "coverage"]);
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const SCRIPT_EXTENSION = /\.(?:js|jsx|ts|tsx)$/;
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
export const RELATIVE = /^\.\.?\//;
const SOURCE_DIRECTORY = "src";

/** A repository's workspace packages, each by its name and its source directory. */
export type TPackages = Readonly<Record<string, string>>;
/** A module a source file imports or re-exports, whether it imports only types, and the line of its import. */
export type TImport = { specifier: string; typeOnly: boolean; line: number };

/** The paths git ignores under `roots`, as patterns over a path from the repository root. An ignored directory's pattern matches what it contains. */
export function gitIgnored(repository: string, roots: readonly string[]): RegExp[] {
	const listed = execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--", ...roots], { cwd: repository, encoding: "utf-8" });
	return listed
		.split("\n")
		.filter((path) => path !== "")
		.map((path) => new RegExp(`^${path.replace(REGEXP_SPECIAL, "\\$&")}${path.endsWith("/") ? "" : "$"}`));
}

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : filesUnder(join(dir, entry.name));
		return entry.isFile() ? [join(dir, entry.name)] : [];
	});
}

/** The TypeScript source files actuality runs under `roots`, each by its path from the repository root: not a declaration, not a test module, not ignored. */
export function sourceFiles(repository: string, roots: readonly string[]): string[] {
	const ignored = gitIgnored(repository, roots);
	return roots
		.flatMap((root) => filesUnder(join(repository, root)))
		.map((file) => relative(repository, file).split(sep).join("/"))
		.filter((path) => SOURCE.test(path) && !DECLARATION.test(path) && !TEST_MODULE.test(path) && !ignored.some((pattern) => pattern.test(path)))
		.sort();
}

const PackageSchema = z.object({ name: z.string().min(1) });

/** The workspace packages in a directory of modules, each by the name its package.json states and its source directory. */
export function workspacePackages(repository: string, modules: string): TPackages {
	const sources = readdirSync(join(repository, modules), { withFileTypes: true }).filter(
		(entry) => entry.isDirectory() && existsSync(join(repository, modules, entry.name, SOURCE_DIRECTORY)),
	);
	return Object.fromEntries(
		sources.map((entry) => [
			PackageSchema.parse(JSON.parse(readFileSync(join(repository, modules, entry.name, "package.json"), "utf-8"))).name,
			`${modules}/${entry.name}/${SOURCE_DIRECTORY}`,
		]),
	);
}

/** A source file of the repository parsed, by its path from the repository root. */
export function parsedSource(repository: string, path: string): ts.SourceFile {
	const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	return ts.createSourceFile(path, readFileSync(join(repository, path), "utf-8"), ts.ScriptTarget.Latest, true, kind);
}

/** The source file a specifier names in the repository, by its path from the repository root, where it names one. */
export function resolvedSource(repository: string, importer: string, specifier: string, packages: TPackages): string | undefined {
	const [owner] = Object.entries(packages)
		.filter(([name]) => specifier === name || specifier.startsWith(`${name}/`))
		.sort(([a], [b]) => b.length - a.length);
	const target = RELATIVE.test(specifier)
		? posix.join(posix.dirname(importer), specifier)
		: owner === undefined
			? undefined
			: posix.join(owner[1], specifier === owner[0] ? "index.js" : specifier.slice(owner[0].length + 1));
	if (target === undefined) return undefined;
	const stem = target.replace(SCRIPT_EXTENSION, "");
	return [...SOURCE_EXTENSIONS.map((extension) => `${stem}${extension}`), `${stem}/index.ts`].find((candidate) => existsSync(join(repository, candidate)));
}

export const lineOf = (node: ts.Node): number => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
const namedTypeOnly = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>) => elements.length > 0 && elements.every((element) => element.isTypeOnly);

/** Each module a source file imports or re-exports, statically or dynamically, and whether it imports only types. */
export function importsOf(source: ts.SourceFile): TImport[] {
	const found: TImport[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.importClause;
			const bindings = clause?.namedBindings;
			const typeOnly =
				clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && namedTypeOnly(bindings.elements)));
			found.push({ specifier: node.moduleSpecifier.text, typeOnly, line: lineOf(node) });
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.exportClause;
			const typeOnly = node.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && namedTypeOnly(clause.elements));
			found.push({ specifier: node.moduleSpecifier.text, typeOnly, line: lineOf(node) });
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [argument] = node.arguments;
			if (argument !== undefined && ts.isStringLiteralLike(argument)) found.push({ specifier: argument.text, typeOnly: false, line: lineOf(node) });
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}
