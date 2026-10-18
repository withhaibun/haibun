/**
 * The kinds of code that haibun's docs/architecture.md states in "How code is organized", each determined by a file's
 * directory or name, or by the `#!` line that starts a program's entry point, and a repository's findings against them. A file in a kind position imports values only from its own
 * kind and the kinds its row lists, and only an adapter performs I/O. A stepper doesn't import another stepper. A stepper
 * and a controller import only the composition root of their own area or of an area that encloses it. A file outside a kind position is a finding,
 * and its imports aren't read.
 */
import { posix } from "node:path";
import ts from "typescript";
import type { TFound } from "./baseline.js";
import { importsOf, lineOf, RELATIVE, resolvedSource, type TPackages, type TSources } from "./repository-files.js";

export const CODE_KINDS = ["domain", "derivation", "machine", "pipeline", "port", "adapter", "composition root", "stepper", "feature", "controller", "view"] as const;
export type TCodeKind = (typeof CODE_KINDS)[number];

/** The directory of an area that holds each kind. A view is a component, a controller is a Lit `ReactiveController`, and a feature builds features. */
const KIND_DIRECTORIES: Record<string, TCodeKind> = {
	domains: "domain",
	derivations: "derivation",
	machines: "machine",
	pipelines: "pipeline",
	adapters: "adapter",
	features: "feature",
	controllers: "controller",
	components: "view",
};
const PORTS_FILE = "ports.ts";
const ROOT_FILE = "root.ts";
const STEPPER_FILE = /-stepper\.tsx?$/;
/** The line a program's entry point starts with, which makes the file a composition root. */
const ENTRY_POINT = "#!";

/**
 * The kinds each kind imports values from, as the table's "Depends on" column lists them. A type import is allowed from any
 * file, since every row allows types. The core types a domain reads aren't kind positions, so the rule doesn't read those
 * imports.
 */
const DEPENDS_ON: Record<TCodeKind, readonly TCodeKind[]> = {
	domain: [],
	derivation: ["domain", "derivation"],
	machine: ["domain"],
	pipeline: ["domain", "derivation", "machine", "port"],
	port: ["domain"],
	adapter: ["port", "domain"],
	"composition root": ["port", "adapter", "machine"],
	stepper: ["domain", "pipeline", "machine", "composition root"],
	feature: ["stepper", "domain", "derivation"],
	controller: ["domain", "derivation", "machine", "pipeline", "composition root"],
	view: ["controller", "domain", "derivation"],
};
/** The kind that doesn't import its own kind: a stepper calls another stepper's steps through dispatch. */
const DISPATCHED: TCodeKind = "stepper";
/** The kinds that import only the composition root of their own area or of an enclosing area. */
const AREA_BOUND: readonly TCodeKind[] = ["stepper", "controller"];

/** The packages only an adapter imports: the filesystem, the network, child processes, timers, database drivers, mail servers, model endpoints and browsers. */
const IO_PACKAGES = new Set([
	"fs",
	"net",
	"child_process",
	"dgram",
	"tls",
	"http",
	"https",
	"http2",
	"dns",
	"timers",
	"worker_threads",
	"readline",
	"pg",
	"@electric-sql/pglite",
	"undici",
	"ws",
	"@hono/node-server",
	"imapflow",
	"nodemailer",
	"node-llama-cpp",
	"playwright",
	"@opentelemetry/exporter-trace-otlp-http",
	"@opentelemetry/exporter-logs-otlp-http",
]);
/** The prefix of a database driver's packages that are I/O beside `IO_PACKAGES`: PGlite's extensions and an alias of one of its versions. */
const IO_PACKAGE_PREFIX = "@electric-sql/pglite-";
/** Returns whether a package performs I/O. */
const isIoPackage = (name: string): boolean => IO_PACKAGES.has(name) || name.startsWith(IO_PACKAGE_PREFIX);
/** The globals that perform I/O, which only an adapter calls: the network, a socket, a browser's database and the timers. */
const IO_GLOBALS = new Set(["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "indexedDB", "setTimeout", "setInterval", "setImmediate"]);
/** The objects whose property is a global. */
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);
const NODE_SCHEME = "node:";

export const UNPOSITIONED = "isn't in a kind position";
const ARTICLE_AN = /^[aeiou]/;
const imports = (kind: TCodeKind, specifier: string) => `imports ${ARTICLE_AN.test(kind) ? "an" : "a"} ${kind}: ${specifier}`;
const performsIo = (through: string) => `performs I/O through ${through}`;
const importsAnotherRoot = (specifier: string) => `imports another area's composition root: ${specifier}`;

/** What a check reads of a repository: its parsed source files, and its workspace packages, each by its name and its source directory. */
export type TCodeScope = { sources: TSources; packages: TPackages };

/** The kind of a file by its path from the repository root, where its directory or name is a kind position, or by its source, where it is a program's entry point. */
export function kindOf(path: string, source?: ts.SourceFile): TCodeKind | undefined {
	const name = posix.basename(path);
	if (name === PORTS_FILE) return "port";
	if (name === ROOT_FILE || source?.text.startsWith(ENTRY_POINT)) return "composition root";
	if (STEPPER_FILE.test(name)) return "stepper";
	const directory = posix
		.dirname(path)
		.split("/")
		.reverse()
		.find((part) => part in KIND_DIRECTORIES);
	return directory === undefined ? undefined : KIND_DIRECTORIES[directory];
}

/** The package an external specifier names: its scope and name, or its name. */
function packageOf(specifier: string): string {
	const parts = specifier.replace(NODE_SCHEME, "").split("/");
	return (specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
}

/** The names a source file binds: variables, parameters, functions, classes and imports, each of which shadows a global of that name. */
function boundNames(source: ts.SourceFile): Set<string> {
	const bound = new Set<string>();
	const visit = (node: ts.Node): void => {
		const declared =
			ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
				? node.name
				: ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)
					? node.name
					: undefined;
		if (declared !== undefined && ts.isIdentifier(declared)) bound.add(declared.text);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return bound;
}

/** The members whose name is a property's name rather than a reading of a global. */
const NAMED_MEMBER: readonly ((node: ts.Node) => boolean)[] = [
	ts.isPropertyAssignment,
	ts.isMethodDeclaration,
	ts.isPropertyDeclaration,
	ts.isPropertySignature,
	ts.isMethodSignature,
	ts.isGetAccessorDeclaration,
	ts.isSetAccessorDeclaration,
	ts.isEnumMember,
];

function inTypePosition(node: ts.Node): boolean {
	for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) if (ts.isTypeNode(at)) return true;
	return false;
}

/** Whether an identifier reads the global of its name, rather than a property, a declaration's name or a type. */
function readsGlobal(node: ts.Identifier): boolean {
	const { parent } = node;
	if (ts.isPropertyAccessExpression(parent) && parent.name === node) return ts.isIdentifier(parent.expression) && GLOBAL_OBJECTS.has(parent.expression.text);
	if (NAMED_MEMBER.some((isMember) => isMember(parent)) && "name" in parent && parent.name === node) return false;
	return !inTypePosition(node);
}

/** Each reading of a global I/O name in a source file, where the file doesn't bind that name itself. */
function globalIoOf(source: ts.SourceFile): ts.Identifier[] {
	const bound = boundNames(source);
	const found: ts.Identifier[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && IO_GLOBALS.has(node.text) && !bound.has(node.text) && readsGlobal(node)) found.push(node);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** The finding an import of a positioned file is, where a file of `kind` at `file` doesn't depend on it. */
function importFinding(kind: TCodeKind, file: string, target: string, targetKind: TCodeKind, specifier: string): string | undefined {
	if (targetKind === kind && kind !== DISPATCHED) return undefined;
	if (!DEPENDS_ON[kind].includes(targetKind)) return imports(targetKind, specifier);
	// An area is its composition root's directory and every directory within it, so a stepper or a controller can import the
	// root of its own area and of each enclosing area.
	return AREA_BOUND.includes(kind) && targetKind === "composition root" && !file.startsWith(`${posix.dirname(target)}/`) ? importsAnotherRoot(specifier) : undefined;
}

/** The findings of each file against the kinds: a file outside a kind position, an import of a kind it doesn't depend on, and I/O outside an adapter. */
export function codeKindFindings(repository: string, { sources, packages }: TCodeScope): TFound[] {
	return [...sources].flatMap(([file, source]): TFound[] => {
		const kind = kindOf(file, source);
		if (kind === undefined) return [{ file, finding: UNPOSITIONED }];
		const valueImports = importsOf(source).filter(({ typeOnly }) => !typeOnly);
		const kindImports = valueImports.flatMap(({ specifier, line }) => {
			const target = resolvedSource(repository, file, specifier, packages);
			const targetKind = target === undefined ? undefined : kindOf(target, sources.get(target));
			const finding = target === undefined || targetKind === undefined ? undefined : importFinding(kind, file, target, targetKind, specifier);
			return finding === undefined ? [] : [{ file, finding, line }];
		});
		if (kind === "adapter") return kindImports;
		const ioImports = valueImports
			.filter(({ specifier }) => !RELATIVE.test(specifier) && isIoPackage(packageOf(specifier)))
			.map(({ specifier, line }) => ({ file, finding: performsIo(specifier), line }));
		const ioGlobals = globalIoOf(source).map((name) => ({ file, finding: performsIo(name.text), line: lineOf(name) }));
		return [...kindImports, ...ioImports, ...ioGlobals];
	});
}
