/**
 * Computes the dependencies of a group of features and a digest of their present content. The digest is the state.
 *
 * A group's dependencies are derived from its configuration and aren't declared a second time. The steppers a
 * configuration lists name the modules a run exercises. Each stepper resolves to a file. The file resolves to the module
 * that contains it. A module resolves to the source directory its tsconfig.json declares. A module also resolves to each
 * `@haibun/` module in the `dependencies` of its package.json. An application's configuration lists framework modules
 * and its own modules, so its dependencies include both without a separate declaration. A group adds its own paths
 * through `dependsOn` and lists the external environments it uses through `environments`.
 *
 * The state is a digest of the content of every file under those paths that its repository tracks or would track.
 * It excludes ignored files. An ignored file is derived output. The state is read from the working tree, so it
 * includes changes that aren't committed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import nodeFS from "node:fs";
import path from "node:path";
import type { TSpecl } from "../../actuality/domains/execution.js";
import { getModuleLocation } from "./workspace-lib.js";
import { itemAt } from "../item-at.js";

/** The name of the file that records how a group's runs went: the state each read, and each level's outcome and duration.
 *  The file is written beside the group's configuration. The state excludes every file with this name, because a run's
 *  record of itself isn't part of the state it read. */
export const RUNS_FILE = "runs.json";

/** Returns the directory of the module that contains a path. That directory is the nearest directory at or above the
 *  path that contains a package.json. Returns undefined for a path that isn't inside a module. */
export function moduleRootOf(location: string): string | undefined {
	let dir = nodeFS.existsSync(location) && nodeFS.statSync(location).isDirectory() ? location : path.dirname(location);
	for (;;) {
		if (nodeFS.existsSync(path.join(dir, "package.json"))) return dir;
		const up = path.dirname(dir);
		if (up === dir) return undefined;
		dir = up;
	}
}

/** Returns the real path of a location. Where the location doesn't exist, returns the real path of its nearest existing
 *  ancestor. A stepper resolves to a file named without its extension, so the file can be absent while its directory
 *  exists. A module linked into node_modules resolves to its directory in the repository that contains its sources. */
function whereItIs(location: string): string {
	let at = location;
	while (!nodeFS.existsSync(at)) {
		const up = path.dirname(at);
		if (up === at) return at;
		at = up;
	}
	return nodeFS.realpathSync(at);
}

/** Returns the real directory of each `@haibun/` module in the `dependencies` of a module's package.json. A change in
 *  one of those directories changes what the module runs. The search for each name starts at the node_modules of the
 *  module's directory and continues at the node_modules of each ancestor directory. Node.js searches in the same order,
 *  so each returned directory is the one Node.js loads for the module. Skips a name that isn't installed. */
function dependedModules(moduleDir: string): string[] {
	const pkgJson = path.join(moduleDir, "package.json");
	if (!nodeFS.existsSync(pkgJson)) return [];
	const pkg = JSON.parse(nodeFS.readFileSync(pkgJson, "utf-8")) as { dependencies?: Record<string, string> };
	const found: string[] = [];
	for (const name of pkg.dependencies === undefined ? [] : Object.keys(pkg.dependencies)) {
		if (!name.startsWith("@haibun/")) continue;
		for (let dir = moduleDir; ; dir = path.dirname(dir)) {
			const candidate = path.join(dir, "node_modules", name);
			if (nodeFS.existsSync(candidate)) {
				found.push(whereItIs(candidate));
				break;
			}
			if (path.dirname(dir) === dir) break;
		}
	}
	return found;
}

/** Returns the real path of the `compilerOptions.rootDir` that a module's tsconfig.json declares. A stepper of the
 *  module runs code built from that directory. Documents, feature groups and other files outside it don't change what
 *  the stepper runs. Returns the module directory where the module doesn't have a tsconfig.json or its tsconfig.json
 *  doesn't declare `rootDir`. Throws where the tsconfig.json can't be read as JSON or the declared directory doesn't
 *  exist. */
function sourcesOf(moduleDir: string): string {
	const tsconfig = path.join(moduleDir, "tsconfig.json");
	if (!nodeFS.existsSync(tsconfig)) return moduleDir;
	let declared: { compilerOptions?: { rootDir?: string } };
	try {
		declared = JSON.parse(nodeFS.readFileSync(tsconfig, "utf-8"));
	} catch (err: unknown) {
		throw new Error(`${tsconfig} could not be read as JSON, so the source directory of ${moduleDir} can't be determined. Correct the file: ${(err as Error).message}`);
	}
	const rootDir = declared.compilerOptions?.rootDir;
	if (!rootDir) return moduleDir;
	const sources = path.resolve(moduleDir, rootDir);
	if (!nodeFS.existsSync(sources)) throw new Error(`${tsconfig} declares rootDir ${rootDir}, and ${sources} doesn't exist. Create the directory or correct rootDir.`);
	return nodeFS.realpathSync(sources);
}

/**
 * Returns the directories that contain a group's dependencies. They are the feature bases, the source directory of each
 * listed stepper's module, the source directory of each `@haibun/` module in those modules' `dependencies` transitively,
 * and each `dependsOn` path. Each directory appears once as an absolute real path, in sorted order. A relative base and a
 * stepper named by a relative path resolve against `cwd`. A run started in `cwd` resolves a relative stepper path the
 * same way. A `dependsOn` path resolves against `configDir`. A caller that computes the roots for a run started in
 * another directory passes that directory as `cwd`. Throws where a `dependsOn` path doesn't exist, where a module's
 * tsconfig.json isn't valid JSON, or where a declared rootDir doesn't exist.
 */
export function dependencyRoots(specl: TSpecl, bases: readonly string[], configDir: string, cwd: string): string[] {
	const roots = new Set<string>();
	for (const base of bases) roots.add(whereItIs(path.resolve(cwd, base)));
	const modules = new Set<string>();
	const follow = (moduleDir: string): void => {
		if (modules.has(moduleDir)) return;
		modules.add(moduleDir);
		roots.add(sourcesOf(moduleDir));
		for (const depended of dependedModules(moduleDir)) follow(depended);
	};
	for (const entry of specl.steppers) {
		if (typeof entry !== "string") continue; // A remote stepper runs in another instance. That instance verifies its own dependencies.
		const root = moduleRootOf(whereItIs(entry.startsWith(".") ? path.resolve(cwd, entry) : getModuleLocation(entry)));
		if (root !== undefined) follow(root);
	}
	for (const dep of specl.dependsOn ?? []) {
		const at = path.resolve(configDir, dep);
		if (!nodeFS.existsSync(at)) throw new Error(`dependsOn names ${dep}, and ${at} doesn't exist. Create the path or remove the entry from dependsOn.`);
		roots.add(nodeFS.realpathSync(at));
	}
	return [...roots].sort();
}

/** Runs git with the given arguments in a directory and returns its standard output. Standard error is piped rather
 *  than inherited, so a caller reads it from the thrown error. */
const git = (dir: string, args: string[], input?: string): string =>
	execFileSync("git", args, { cwd: dir, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...(input === undefined ? {} : { input }) });

/** Returns the top-level directory of the repository that contains a directory. Returns undefined where the directory
 *  isn't in a repository. Throws on any other git failure. An undefined result for that failure would make every group
 *  run without consulting its record and wouldn't report the failure. */
export function repositoryTop(dir: string): string | undefined {
	try {
		return git(dir, ["rev-parse", "--show-toplevel"]).trim();
	} catch (err: unknown) {
		const said = String((err as { stderr?: string }).stderr ?? "").trim();
		if (said.includes("not a git repository")) return undefined;
		throw new Error(
			`git rev-parse --show-toplevel failed in ${dir}, so its dependency state can't be read. Check that the directory exists and that git runs there: ${said || (err as Error).message}`,
		);
	}
}

type TRepositoryFile = { file: string; digest: string };

/** Returns true for a path that `git hash-object --stdin-paths` can't read from a line. That command reads one path per
 *  line and unquotes a line that begins with a quotation mark. */
const unnameable = (file: string): boolean => file.includes("\n") || file.startsWith('"');

/** Returns the directory's path relative to its repository's top, and the path and the working-tree content digest of
 *  each file under the directory that its repository tracks or would track. A symbolic link's digest is its target path. A listed directory is a nested repository or a submodule.
 *  The result skips it, because that directory's own repository holds its content. The result excludes the files a run
 *  writes about itself. Returns undefined where the directory isn't in a repository. */
function repositoryFiles(dir: string): { rel: string; files: TRepositoryFile[] } | undefined {
	const top = repositoryTop(dir);
	if (top === undefined) return undefined;
	const rel = path.relative(top, dir);
	const files: string[] = [];
	const links: TRepositoryFile[] = [];
	for (const listed of git(dir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."]).split("\0")) {
		if (listed.length === 0 || path.basename(listed) === RUNS_FILE) continue;
		const file = path.join(rel, listed);
		let stat: nodeFS.Stats;
		try {
			stat = nodeFS.lstatSync(path.join(top, file));
		} catch {
			continue; // A file in the index and missing from the working tree is a deletion. Its absence from the result records the deletion.
		}
		if (stat.isSymbolicLink()) links.push({ file, digest: `link ${nodeFS.readlinkSync(path.join(top, file))}` });
		else if (stat.isFile()) files.push(file);
	}
	const plain = files.filter((f) => !unnameable(f));
	const digests = plain.length
		? git(top, ["hash-object", "--stdin-paths"], `${plain.join("\n")}\n`)
				.trim()
				.split("\n")
		: [];
	const out = plain.map((file, i) => ({ file, digest: itemAt(digests, i) }));
	for (const file of files.filter(unnameable))
		out.push({
			file,
			digest: createHash("sha256")
				.update(nodeFS.readFileSync(path.join(top, file)))
				.digest("hex"),
		});
	return { rel, files: [...out, ...links].sort((a, b) => (a.file < b.file ? -1 : 1)) };
}

/**
 * Returns one digest of the content of every file under every root and of the declared environments. The digest
 * includes each root's path relative to its repository's top, so the same content under another root path gives
 * another digest, and a checkout at another directory gives the same digest. The roots are taken in the order of those
 * paths and their content, and the environments are sorted, so the order of each doesn't change the digest. Throws where git fails
 * in a root for a reason other than a missing repository.
 *
 * Returns undefined where a root's state can't be read. Undefined is an unknown state and differs from an empty state.
 * A root's state can't be read where the root isn't in a repository or doesn't contain a file its repository tracks or
 * would track. An installed module that the repository ignores is such a root. A group that depends on such a root
 * runs every time, rather than never.
 */
export function dependencyState(roots: readonly string[], environments: readonly string[] = []): string | undefined {
	const hash = createHash("sha256");
	const stated: string[] = [];
	for (const root of roots) {
		const held = repositoryFiles(root);
		if (held === undefined || held.files.length === 0) return undefined;
		stated.push(`root ${held.rel}\n${held.files.map(({ file, digest }) => `${digest} ${file}\n`).join("")}`);
	}
	for (const root of stated.sort()) hash.update(root);
	for (const environment of [...environments].sort()) hash.update(`environment ${environment}\n`);
	return hash.digest("hex");
}
