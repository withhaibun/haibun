/**
 * The files of a repository a check reads under its roots, by their paths from the repository root. A file git ignores
 * isn't read, since it isn't part of what a commit holds.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ts from "typescript";
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
/** The directory that holds each package's TypeScript build of its source directory. */
const BUILD_DIRECTORY = "build";
/** The conditions that select a target of an export map, as haibun's tooling resolves a workspace package. `haibun-source` selects its source. */
const EXPORT_CONDITIONS = new Set(["haibun-source", "import", "default"]);
const PACKAGE_ROOT = ".";
const SUBPATH_WILDCARD = "*";
/** The file a package's root resolves to where its package.json doesn't state an export map. */
const DEFAULT_ENTRY = "./index.js";

/** A target in a package's export map: a path from the package's directory, or the targets by condition. */
type TExportTarget = string | { [condition: string]: TExportTarget };
const ExportTargetSchema: z.ZodType<TExportTarget> = z.lazy(() => z.union([z.string(), z.record(z.string(), ExportTargetSchema)]));
/** A workspace package: its directory from the repository root, and its export map by subpath where its package.json states one. */
export type TPackage = { directory: string; exports?: Readonly<Record<string, TExportTarget>> };
/** A repository's workspace packages, each by its name. */
export type TPackages = Readonly<Record<string, TPackage>>;
/** The source directory of a workspace package. */
export const sourceDirectoryOf = ({ directory }: TPackage): string => posix.join(directory, SOURCE_DIRECTORY);
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

const PackageSchema = z.object({ name: z.string().min(1), exports: ExportTargetSchema.optional() });

/** An export map by subpath. A map whose keys aren't subpaths, or a single target, is the target of the package's root. */
function bySubpath(exports: TExportTarget): Record<string, TExportTarget> {
	return typeof exports === "object" && Object.keys(exports).every((key) => key.startsWith(PACKAGE_ROOT)) ? exports : { [PACKAGE_ROOT]: exports };
}

/** The workspace packages in a directory of modules, each by the name its package.json states, with its directory and export map. */
export function workspacePackages(repository: string, modules: string): TPackages {
	const sources = readdirSync(join(repository, modules), { withFileTypes: true }).filter(
		(entry) => entry.isDirectory() && existsSync(join(repository, modules, entry.name, SOURCE_DIRECTORY)),
	);
	return Object.fromEntries(
		sources.map((entry) => {
			const directory = `${modules}/${entry.name}`;
			const { name, exports } = PackageSchema.parse(JSON.parse(readFileSync(join(repository, directory, "package.json"), "utf-8")));
			return [name, exports === undefined ? { directory } : { directory, exports: bySubpath(exports) }];
		}),
	);
}

/** A source file of the repository parsed, by its path from the repository root. */
export function parsedSource(repository: string, path: string): ts.SourceFile {
	const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	return ts.createSourceFile(path, readFileSync(join(repository, path), "utf-8"), ts.ScriptTarget.Latest, true, kind);
}

/** Source files parsed once, each by its path from the repository root. Each code check reads the same parse. */
export type TSources = ReadonlyMap<string, ts.SourceFile>;

/** Each of `files` parsed, by its path from the repository root. */
export function parsedSources(repository: string, files: readonly string[]): TSources {
	return new Map(files.map((file) => [file, parsedSource(repository, file)]));
}

/** The const declarations of a source file by name, each with its initializer. */
export function constInitializers(source: ts.SourceFile): Map<string, ts.Expression> {
	const consts = new Map<string, ts.Expression>();
	const visit = (node: ts.Node): void => {
		if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const) !== 0) {
			for (const declaration of node.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) consts.set(declaration.name.text, declaration.initializer);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return consts;
}

/** The path a target selects under the export conditions, where one of its conditions is active. */
function conditionalPath(target: TExportTarget): string | undefined {
	if (typeof target === "string") return target;
	const selected = Object.entries(target).find(([condition]) => EXPORT_CONDITIONS.has(condition));
	return selected === undefined ? undefined : conditionalPath(selected[1]);
}

/**
 * The path from a package's directory that a subpath of it names: through the export map's exact subpath or its longest
 * wildcard subpath, as Node resolves it, or the subpath itself where the package doesn't state an export map.
 */
function exportedPath({ exports }: TPackage, subpath: string): string | undefined {
	if (exports === undefined) return subpath === PACKAGE_ROOT ? DEFAULT_ENTRY : subpath;
	const exact = exports[subpath];
	if (exact !== undefined) return conditionalPath(exact);
	const [pattern] = Object.entries(exports)
		.map(([key, target]) => ({ key, target, star: key.indexOf(SUBPATH_WILDCARD) }))
		.filter(({ key, star }) => star >= 0 && subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1)) && subpath.length >= key.length - 1)
		.sort((a, b) => b.star - a.star);
	if (pattern === undefined) return undefined;
	const matched = subpath.slice(pattern.star, subpath.length - (pattern.key.length - pattern.star - 1));
	return conditionalPath(pattern.target)?.replaceAll(SUBPATH_WILDCARD, matched);
}

/** The path from the repository root of what a workspace specifier names, with a build file read as the source file it compiles. */
function packagedTarget(specifier: string, packages: TPackages): string | undefined {
	const [owner] = Object.entries(packages)
		.filter(([name]) => specifier === name || specifier.startsWith(`${name}/`))
		.sort(([a], [b]) => b.length - a.length);
	if (owner === undefined) return undefined;
	const [name, found] = owner;
	const path = exportedPath(found, specifier === name ? PACKAGE_ROOT : `${PACKAGE_ROOT}${specifier.slice(name.length)}`);
	if (path === undefined) return undefined;
	const target = posix.join(found.directory, path);
	const build = `${posix.join(found.directory, BUILD_DIRECTORY)}/`;
	return target.startsWith(build) ? posix.join(sourceDirectoryOf(found), target.slice(build.length)) : target;
}

/** The source file a specifier names in the repository, by its path from the repository root, where it names one. */
export function resolvedSource(repository: string, importer: string, specifier: string, packages: TPackages): string | undefined {
	const target = RELATIVE.test(specifier) ? posix.join(posix.dirname(importer), specifier) : packagedTarget(specifier, packages);
	if (target === undefined) return undefined;
	const stem = target.replace(SCRIPT_EXTENSION, "");
	return [...SOURCE_EXTENSIONS.map((extension) => `${stem}${extension}`), `${stem}/index.ts`].find((candidate) => existsSync(join(repository, candidate)));
}

/** The expression an expression stands for, through parentheses, non-null assertions and type assertions. */
export const unwrapped = (node: ts.Expression): ts.Expression =>
	ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)
		? unwrapped(node.expression)
		: node;

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
