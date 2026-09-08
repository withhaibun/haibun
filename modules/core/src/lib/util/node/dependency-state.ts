/**
 * What a run of features depends on, and the state of it: the content every declared and derived dependency has now.
 *
 * A run's steppers name the modules it exercises, so a group's dependencies are derived from the configuration it
 * already has rather than declared a second time: each stepper resolves to a file, the file to the module holding it,
 * a module to the directory its own build configuration says it is built from, and a module to the modules it depends
 * on in turn. An application's configuration names the framework's modules beside its own, so its dependencies span
 * both without saying so. A group adds paths of its own through `dependsOn`, and names the external environments it
 * uses.
 *
 * The state is a digest of the content of every file under those paths that its repository tracks or would track:
 * ignored files are derived output and are left out. It is read from the working tree, so what is verified is what is
 * about to run, whether or not it is committed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import nodeFS from "node:fs";
import path from "node:path";
import type { TSpecl } from "../../execution.js";
import { getModuleLocation } from "./workspace-lib.js";

/** The file a group's runs are recorded in. It lives among the group's own files and is left out of the state, since
 *  a record of the state is not part of it. */
export const VERIFIED_FILE = "verified.json";

/** The directory of the module a path belongs to: the nearest ancestor holding a package.json. Undefined for a path
 *  that belongs to no module. */
export function moduleRootOf(location: string): string | undefined {
	let dir = nodeFS.existsSync(location) && nodeFS.statSync(location).isDirectory() ? location : path.dirname(location);
	for (;;) {
		if (nodeFS.existsSync(path.join(dir, "package.json"))) return dir;
		const up = path.dirname(dir);
		if (up === dir) return undefined;
		dir = up;
	}
}

/** The nearest existing ancestor of a path, resolved through links to where it really is. A stepper resolves to a
 *  file named without its extension, so the file may not exist while its directory does; a linked module resolves to
 *  the repository that holds its sources. */
function whereItIs(location: string): string {
	let at = location;
	while (!nodeFS.existsSync(at)) {
		const up = path.dirname(at);
		if (up === at) return at;
		at = up;
	}
	return nodeFS.realpathSync(at);
}

/** The framework modules a module depends on, each as the directory that holds it: what a change to one of them
 *  reaches. Read from the module's own declaration and resolved through its own node_modules, so the answer is what
 *  the module would load. */
function dependedModules(moduleDir: string): string[] {
	const pkgJson = path.join(moduleDir, "package.json");
	if (!nodeFS.existsSync(pkgJson)) return [];
	const pkg = JSON.parse(nodeFS.readFileSync(pkgJson, "utf-8")) as { dependencies?: Record<string, string> };
	const found: string[] = [];
	for (const name of Object.keys(pkg.dependencies ?? {})) {
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

/** What a module is built from, where its own build configuration says: a change to the module reaches its sources,
 *  and its tests, its documents and the groups of features it holds are not what a stepper of it runs. A module that
 *  declares no such directory is depended on whole. */
function sourcesOf(moduleDir: string): string {
	const tsconfig = path.join(moduleDir, "tsconfig.json");
	if (!nodeFS.existsSync(tsconfig)) return moduleDir;
	let declared: { compilerOptions?: { rootDir?: string } };
	try {
		declared = JSON.parse(nodeFS.readFileSync(tsconfig, "utf-8"));
	} catch (err: unknown) {
		throw new Error(`${tsconfig} could not be read, so what ${moduleDir} is built from is not known: ${(err as Error).message}`);
	}
	const rootDir = declared.compilerOptions?.rootDir;
	if (!rootDir) return moduleDir;
	const sources = path.resolve(moduleDir, rootDir);
	if (!nodeFS.existsSync(sources)) throw new Error(`${tsconfig} says the module is built from ${rootDir}, and there is nothing at ${sources}`);
	return nodeFS.realpathSync(sources);
}

/**
 * The directories a group's features depend on: the bases the features are read from, the sources of the module of
 * every stepper the configuration names, the sources of every framework module those modules depend on, and the
 * paths the configuration adds. Each once, absolute and real, in a stable order. A stepper named by a relative path is
 * resolved from the directory the run is made from, as the run resolves it, so a process deciding for another
 * computes what that other would.
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
		if (typeof entry !== "string") continue; // a remote stepper is another instance's, and that instance verifies its own
		const root = moduleRootOf(whereItIs(entry.startsWith(".") ? path.resolve(cwd, entry) : getModuleLocation(entry)));
		if (root !== undefined) follow(root);
	}
	for (const dep of specl.dependsOn ?? []) {
		const at = path.resolve(configDir, dep);
		if (!nodeFS.existsSync(at)) throw new Error(`dependsOn names ${dep}, and there is nothing at ${at}`);
		roots.add(nodeFS.realpathSync(at));
	}
	return [...roots].sort();
}

/** Ask git something in a directory. What it says on failure is kept, since the failure is what is reported. */
const git = (dir: string, args: string[], input?: string): string =>
	execFileSync("git", args, { cwd: dir, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...(input === undefined ? {} : { input }) });

/** The top of the repository a directory is in, or undefined where it is in none. Any other failure to ask is a
 *  failure and is said: a state read with git absent or refused would run every group unverified without a word. */
function repositoryTop(dir: string): string | undefined {
	try {
		return git(dir, ["rev-parse", "--show-toplevel"]).trim();
	} catch (err: unknown) {
		const said = String((err as { stderr?: string }).stderr ?? "").trim();
		if (said.includes("not a git repository")) return undefined;
		throw new Error(`could not ask git about ${dir}: ${said || (err as Error).message}`);
	}
}

type TRepositoryFile = { file: string; digest: string };

/** A name `hash-object` cannot be given on a line: it reads one path per line and unquotes a line that begins with a
 *  quotation mark. */
const unnameable = (file: string): boolean => file.includes("\n") || file.startsWith('"');

/** The files under a directory that its repository tracks or would track, each with the digest of its content as it
 *  is in the working tree; a link by what it points at. A directory listed is a nested repository or a submodule, whose
 *  content is its own to verify. Undefined where the directory is in no repository. */
function repositoryFiles(dir: string): TRepositoryFile[] | undefined {
	const top = repositoryTop(dir);
	if (top === undefined) return undefined;
	const rel = path.relative(top, dir);
	const files: string[] = [];
	const links: TRepositoryFile[] = [];
	for (const listed of git(dir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."]).split("\0")) {
		if (listed.length === 0 || path.basename(listed) === VERIFIED_FILE) continue;
		const file = path.join(rel, listed);
		let stat: nodeFS.Stats;
		try {
			stat = nodeFS.lstatSync(path.join(top, file));
		} catch {
			continue; // listed from the index and gone from the tree: a deletion, which its absence here states
		}
		if (stat.isSymbolicLink()) links.push({ file, digest: `link ${nodeFS.readlinkSync(path.join(top, file))}` });
		else if (stat.isFile()) files.push(file);
	}
	const plain = files.filter((f) => !unnameable(f));
	const digests = plain.length ? git(top, ["hash-object", "--stdin-paths"], `${plain.join("\n")}\n`).trim().split("\n") : [];
	const out = plain.map((file, i) => ({ file, digest: digests[i] }));
	for (const file of files.filter(unnameable)) out.push({ file, digest: createHash("sha256").update(nodeFS.readFileSync(path.join(top, file))).digest("hex") });
	return [...out, ...links].sort((a, b) => (a.file < b.file ? -1 : 1));
}

/**
 * One digest of the state of every dependency: the content of every file under every root, and the environments
 * declared. The same state gives the same digest wherever it is computed.
 *
 * Undefined where the state cannot be read, which is a state of nothing known rather than a state of nothing: a root
 * in no repository, or one whose files the repository ignores, as a module installed rather than linked is. A group
 * depending on such a root runs every time rather than never.
 */
export function dependencyState(roots: readonly string[], environments: readonly string[] = []): string | undefined {
	const hash = createHash("sha256");
	for (const root of roots) {
		const files = repositoryFiles(root);
		if (files === undefined || files.length === 0) return undefined;
		hash.update(`root ${root}\n`);
		for (const { file, digest } of files) hash.update(`${digest} ${file}\n`);
	}
	for (const environment of [...environments].sort()) hash.update(`environment ${environment}\n`);
	return hash.digest("hex");
}
