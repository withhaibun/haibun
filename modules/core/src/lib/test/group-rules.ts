/**
 * Rules for the test groups of a repository and for its first-read documents. A group states its options in its config's `options`
 * and `moduleOptions`, and a script states only its command. A group names what it uses by its package rather than by a
 * parent path or a link. A first-read document names only paths that exist. A group's actualities file and every baseline are
 * tracked, so each commit holds the measurements of the code it holds.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import ts from "typescript";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { itemAt } from "../domains/item-at.js";
import type { TFound } from "./baseline.js";
import { TEST_MODULE } from "./repository-files.js";
import { ACTUALITIES_FILE } from "../adapters/dependency-state.js";

/** An option of haibun that a script assigns before a command, which a config states instead. */
const OPTION_ASSIGNMENT = /\bHAIBUN_[A-Z0-9_]+(?==)/g;
const PackageScriptsSchema = z.object({ scripts: z.record(z.string(), z.string()).optional() });
/** A markdown link's target, and a file path in backticks. */
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
const QUOTED_PATH = /`((?:\.{1,2}\/)?[\w-]+(?:\/[\w.-]+)+\.(?:md|json|mjs|sh|feature|ts|yml))`/g;
const NOT_A_PATH = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;
const GENERATED = /(?:^|\/)(?:build|build-local|node_modules|capture)\//;
/** A string of a JSON file that names a path through a parent directory. */
const PARENT_PATH = /"([^"]*\.\.\/[^"]*)"/g;
/** The mode git records for a symbolic link. */
const LINK_MODE = "120000";
/** A kireji feature or background of a group or a service, and a package's code, which a feature names by its package. */
const FEATURE_SOURCE = /\.feature\.ts$|\/(features|backgrounds)\/[^/]+\.ts$/;
const PACKAGE_CODE = /(^|\/)(src|build)\//;
const IMPORTED = /\bfrom\s+["']([^"']+)["']/g;
/** A module a file of code imports: after `from`, as a bare import, or as a dynamic import. */
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g;
/** A file of code, whose imports are read, and a JSON file, whose relative paths are read. */
const CODE_FILES = ["ts", "tsx", "mts", "js", "mjs", "cjs"].map((extension) => `:(glob)**/*.${extension}`);
const JSON_FILE = ":(glob)**/*.json";
/** A path from the file that names it: `./` or `../`, then the rest. */
const RELATIVE_PATH = /^\.\.?\//;
/** What a pattern of paths, such as a tsconfig's `paths`, matches from: the part before its first wildcard. */
const WILDCARD = /\*.*$/;
/** A config of a group, which lists the steppers it loads and the external environments its features use. */
const GroupConfigSchema = z.object({ steppers: z.array(z.unknown()), environments: z.array(z.string()).optional() });
/** A baseline that a rule test reads, a long-term tracking file beside a group's actualities file. */
/** The suffix of every baseline file's name. */
const BASELINE_SUFFIX = ".baseline.json";
const BASELINE = `:(glob)**/*${BASELINE_SUFFIX}`;

/** The files git tracks in a repository that match a pattern, by their paths from the repository root. */
export const trackedFiles = (repository: string, pattern: string): string[] =>
	execFileSync("git", ["ls-files", "--", pattern], { cwd: repository, encoding: "utf-8" }).split("\n").filter(Boolean);

/** Each option of haibun that a script of a tracked package.json assigns before its command, which the config the command reads states
 *  in its `options` or `moduleOptions` instead. */
export function optionAssignments(repository: string): TFound[] {
	return trackedFiles(repository, "*package.json").flatMap((file) =>
		Object.entries(PackageScriptsSchema.parse(JSON.parse(readFileSync(join(repository, file), "utf-8"))).scripts ?? {}).flatMap(([name, script]) =>
			(script.match(OPTION_ASSIGNMENT) ?? []).map((option) => ({ file, finding: `script ${name} states ${option}` })),
		),
	);
}

/** Each symbolic link a repository commits, each parent path that a group's config names, each script of a package.json that
 *  names a parent path or a path in another package, and each import by a parent path of a package's code from a group's or a service's feature. A group names a
 *  stepper, a base config, a waypoint base, a dependency and the code its features import by its package, and a script calls
 *  `haibun-cli`, which npm puts on the path, so the group runs the same wherever the repository is checked out. */
export function linksAndParentPaths(repository: string): TFound[] {
	const links = execFileSync("git", ["ls-files", "-s"], { cwd: repository, encoding: "utf-8" })
		.split("\n")
		.filter((line) => line.startsWith(`${LINK_MODE} `))
		.map((line) => ({ file: itemAt(line.split("\t"), 1), finding: "is a symbolic link, which a checkout elsewhere doesn't resolve" }));
	const configs = trackedFiles(repository, ":(glob)**/config*.json").flatMap((file) => {
		const text = readFileSync(join(repository, file), "utf-8");
		if (!GroupConfigSchema.safeParse(JSON.parse(text)).success) return [];
		return [...text.matchAll(PARENT_PATH)].map((m) => ({ file, finding: `names ${itemAt(m, 1)}, a parent path` }));
	});
	const scripts = trackedFiles(repository, "*package.json").flatMap((file) =>
		Object.entries(PackageScriptsSchema.parse(JSON.parse(readFileSync(join(repository, file), "utf-8"))).scripts ?? {}).flatMap(([name, script]) => [
			...(script.includes("../") ? [{ file, finding: `script ${name} names a parent path` }] : []),
			...script
				.split(/\s+/)
				.filter((word) => !word.startsWith("-") && existsSync(join(repository, dirname(file), word)))
				.filter((word) => packagesHolding(repository, relative(repository, join(repository, dirname(file), word))).some((dir) => dir !== dirname(file)))
				.map((word) => ({ file, finding: `script ${name} names ${word}, a path in another package` })),
		]),
	);
	const imports = trackedFiles(repository, "*.ts")
		.filter((file) => FEATURE_SOURCE.test(file) && !PACKAGE_CODE.test(file) && !TEST_MODULE.test(file))
		.flatMap((file) =>
			[...readFileSync(join(repository, file), "utf-8").matchAll(IMPORTED)]
				.map((m) => itemAt(m, 1))
				.filter((specifier) => specifier.startsWith("../") && PACKAGE_CODE.test(normalize(join(dirname(file), specifier))))
				.map((specifier) => ({ file, finding: `imports ${specifier}, a package's code, by a parent path` })),
		);
	return [...links, ...configs, ...scripts, ...imports, ...pathsOutOfRepository(repository)];
}

/** A tracked JSON file's value, read as TypeScript reads a tsconfig, which allows comments. Throws where it doesn't parse. */
function jsonOf(repository: string, file: string): unknown {
	const errors: ts.Diagnostic[] = [];
	const value: unknown = ts.convertToObject(ts.parseJsonText(file, readFileSync(join(repository, file), "utf-8")), errors);
	const [error] = errors;
	if (error !== undefined) throw new Error(`${file} doesn't parse as JSON: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}. Correct it.`);
	return value;
}

/** Whether a path from the repository root passes through a symbolic link, which names a place outside the repository. */
const throughLink = (repository: string, at: string): boolean =>
	at.split(sep).some((_, i, parts) => {
		const prefix = join(repository, ...parts.slice(0, i + 1));
		return existsSync(prefix) && lstatSync(prefix).isSymbolicLink();
	});

/** Each string of a JSON value, however deeply it nests. */
const stringsOf = (value: unknown): string[] => (typeof value === "string" ? [value] : typeof value === "object" && value !== null ? Object.values(value).flatMap(stringsOf) : []);

/** The directories from a path up to the repository root, apart from the root, that hold a package.json: each package that holds the path. */
const packagesHolding = (repository: string, at: string): string[] =>
	at
		.split(sep)
		.filter((part) => part !== "" && part !== ".")
		.map((_, i, parts) => parts.slice(0, i + 1).join(sep))
		.filter((dir) => existsSync(join(repository, dir, "package.json")));

/** Each relative path of a tracked file of code or JSON file, by its path from the repository root, that names a place the repository
 *  doesn't hold: outside its root, through a link, or in a package its .gitignore ignores, such as another repository's checkout or an
 *  installed package. A file of code names another package by the package's name, and a config names a base or a preset by its
 *  package's export, so each resolves as Node resolves it wherever the repository is checked out. */
function pathsOutOfRepository(repository: string): TFound[] {
	const named = [
		...CODE_FILES.flatMap((pattern) => trackedFiles(repository, pattern)).flatMap((file) =>
			[...readFileSync(join(repository, file), "utf-8").matchAll(IMPORT_SPECIFIER)].map((m) => ({ file, path: itemAt(m, 1), verb: "imports" })),
		),
		...trackedFiles(repository, JSON_FILE).flatMap((file) => stringsOf(jsonOf(repository, file)).map((path) => ({ file, path, verb: "names" }))),
	]
		.filter(({ path }) => RELATIVE_PATH.test(path))
		.map((found) => ({ ...found, at: relative(repository, resolve(repository, dirname(found.file), found.path.replace(WILDCARD, ""))) }));
	const outside = named.filter(({ at }) => at.startsWith("..") || isAbsolute(at) || throughLink(repository, at));
	const holding = new Map(named.filter((found) => !outside.includes(found)).map(({ at }) => [at, packagesHolding(repository, at)]));
	const ignored = ignoredOf(repository, [...new Set([...holding.values()].flat())]);
	return named
		.filter((found) => outside.includes(found) || holding.get(found.at)?.some((dir) => ignored.has(dir)))
		.map(({ file, path, verb }) => ({ file, finding: `${verb} ${path}, which the repository doesn't hold: name it by its package` }));
}

/** The paths of `files` that a .gitignore entry of the repository ignores, whether or not git tracks them. */
function ignoredOf(repository: string, files: readonly string[]): Set<string> {
	const checked = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: repository, input: files.join("\n"), encoding: "utf-8" });
	if (checked.status !== 0 && checked.status !== 1) throw new Error(`git check-ignore failed in ${repository}: ${checked.stderr}. Check that git runs there.`);
	return new Set(checked.stdout.split("\n").filter(Boolean));
}

/** Lists the files of `pattern` in a repository by git's arguments `args`, each by its path from the repository root. */
const listed = (repository: string, args: readonly string[], pattern: string): string[] =>
	execFileSync("git", ["ls-files", ...args, "--", pattern], { cwd: repository, encoding: "utf-8" })
		.split("\n")
		.filter(Boolean);

/**
 * Each baseline a repository holds, tracked or not, ignored or not. An untracked listing reads every directory it reaches, and
 * an ignored directory such as node_modules holds hundreds of thousands of entries, so the listing doesn't enter one: the
 * untracked files outside ignored directories, and the ignored files outside them, named as ignored directories where git
 * stops. A baseline isn't kept inside an ignored directory, so the two listings hold every baseline.
 */
function baselineFiles(repository: string): string[] {
	const kept = listed(repository, ["--cached", "--others", "--exclude-standard"], BASELINE);
	const ignored = listed(repository, ["--others", "--ignored", "--exclude-standard", "--directory"], BASELINE).filter((file) => file.endsWith(BASELINE_SUFFIX));
	return [...new Set([...kept, ...ignored])];
}

/**
 * Each long-term tracking file that a repository doesn't hold with its version. Every group directory, by its path from the repository
 * root, and every directory under it in the same package that holds a group's config, such as an instance a feature launches, holds its actualities file
 * tracked, since a commit holds the durations and outcomes of the code it measures. A config that declares an environment runs
 * where that environment is, which commits its actualities file from there. A baseline is tracked. A .gitignore entry doesn't
 * ignore either, since a later run would write a file git leaves out.
 */
export function untrackedRecords(repository: string, groupDirectories: readonly string[]): TFound[] {
	const tracked = new Set(trackedFiles(repository, "."));
	const nested = groupDirectories.flatMap((dir) =>
		trackedFiles(repository, `:(glob)${dir}/**/config*.json`)
			.filter((file) => packagesHolding(repository, dirname(file)).join() === packagesHolding(repository, dir).join())
			.filter((file) => {
				const config = GroupConfigSchema.safeParse(JSON.parse(readFileSync(join(repository, file), "utf-8")));
				return config.success && !config.data.environments?.length;
			})
			.map(dirname),
	);
	const records = [...new Set([...groupDirectories, ...nested])].sort().map((dir) => join(dir, ACTUALITIES_FILE));
	const baselines = baselineFiles(repository);
	const ignored = ignoredOf(repository, [...records, ...baselines]);
	return [...records, ...baselines].flatMap((file) => [
		...(tracked.has(file) ? [] : [{ file, finding: "isn't tracked: run its group, or its rule test, and commit the file with the code it measures" }]),
		...(ignored.has(file) ? [{ file, finding: "is ignored by a .gitignore entry: remove the entry, so a commit holds the file" }] : []),
	]);
}

/** Each relative link and each quoted path of the markdown documents, by their paths from the repository root, that names a path
 *  absent from the repository. A path resolves from its document or from the repository root. */
export function brokenPaths(repository: string, documents: readonly string[]): TFound[] {
	return documents.flatMap((document) => {
		const text = readFileSync(join(repository, document), "utf-8");
		const named = [...text.matchAll(MARKDOWN_LINK)].map((m) => itemAt(m, 1)).filter((target) => !NOT_A_PATH.test(target));
		const quoted = [...text.matchAll(QUOTED_PATH)].map((m) => itemAt(m, 1)).filter((target) => !GENERATED.test(target));
		return [...named, ...quoted]
			.map((target) => target.replace(/#.*/, ""))
			.filter((target) => target !== "")
			.filter((target) => !existsSync(resolve(repository, dirname(document), target)) && !existsSync(resolve(repository, target)))
			.map((target) => ({ file: document, finding: `names ${target}, which the repository doesn't hold` }));
	});
}
