import path, { dirname } from "path";
import nodeFS from "fs";

import { namesPackage, type TStepperEntry } from "../actuality/domains/actuality.js";
import { CStepper } from "../steps/domains/stepper.js";
import { createSteppers } from "../domains/util.js";
import { use } from "./module-loader.js";
import { fileURLToPath } from "url";
import type { RemoteStepperProxy } from "../transport/remote-proxy-stepper.js";

/** The file-system calls feature collection and workspace discovery make, which a test gives in place of node's. */
export type TFileSystem = Pick<typeof nodeFS, "existsSync" | "readdirSync" | "statSync" | "readFileSync">;
/** The steppers the entries name, loaded and constructed, with any further stepper classes after them. */
export async function getCreateSteppers(steppers: TStepperEntry[], addSteppers: CStepper[] = []) {
	return createSteppers((await getSteppers(steppers)).concat(addSteppers));
}

export async function getSteppers(stepperEntries: TStepperEntry[]) {
	const steppers: CStepper[] = [];
	for (const entry of stepperEntries) {
		if (typeof entry === "string") {
			try {
				// A stepper is loaded once, however many entries name it: a run adds one with --with-steppers that its config may list.
				const S = await getStepper(entry);
				if (!steppers.includes(S)) steppers.push(S);
			} catch (e) {
				console.error(`get ${entry} from "${getModuleLocation(entry)}" failed`, e);
				throw e;
			}
		} else {
			// Remote stepper: create a factory that returns a pre-configured RemoteStepperProxy
			const { remote } = entry;
			const RemoteProxy = (await use(REMOTE_PROXY)) as unknown as typeof RemoteStepperProxy;
			steppers.push(
				class extends RemoteProxy {
					constructor() {
						super(remote);
					}
				},
			);
		}
	}
	return steppers;
}
export const workspaceRoot = getWorkspaceRoot();

type TImportMeta = { url: string };

export function getPackageLocation(meta: TImportMeta) {
	return dirname(fileURLToPath(meta.url));
}

function getWorkspaceRoot() {
	let currentDir = path.resolve(process.cwd());

	while (true) {
		const packageJsonPath = path.resolve(currentDir, "package.json");
		if (nodeFS.existsSync(packageJsonPath)) {
			const pkg = JSON.parse(nodeFS.readFileSync(packageJsonPath, "utf-8"));
			if (pkg.name === "haibun" || pkg.workspaces) return currentDir;
		}
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	return process.cwd();
}

const pkgJsonCache = new Map<string, TPackageJson>();

/** Resolved at module init to avoid repeated fileURLToPath + path.resolve on every stepper load.
 *  Uses getPackageLocation so the path is correct whether core is a linked/installed dependency
 *  (build/steps) or the current workspace in src mode (src/steps). */
const CORE_STEPS_DIR = path.resolve(getPackageLocation(import.meta), "../../steps");
/** Where core's remote stepper proxy is, which the stepper of a remote entry extends. The loader reads it as it reads every stepper. */
const REMOTE_PROXY = path.join(CORE_STEPS_DIR, "../lib/transport/remote-proxy-stepper");

type TExportTarget = string | Record<string, string>;
type TPackageJson = { name?: string; exports?: Record<string, TExportTarget> };

function packageJsonAt(dir: string, fs: Pick<TFileSystem, "existsSync" | "readFileSync">): TPackageJson | undefined {
	const at = path.join(dir, "package.json");
	if (!fs.existsSync(at)) return undefined;
	const cached = pkgJsonCache.get(at);
	if (cached) return cached;
	const read: TPackageJson = JSON.parse(String(fs.readFileSync(at, "utf-8")));
	pkgJsonCache.set(at, read);
	return read;
}

/** Returns the name of the nearest package at or above the directory of the file `at`, or undefined where a directory at or
 *  above it doesn't hold a package that names itself. */
export function packageNameAt(at: string, fs: Pick<TFileSystem, "existsSync" | "readFileSync">): string | undefined {
	for (let dir = path.dirname(path.resolve(at)); ; dir = path.dirname(dir)) {
		const name = packageJsonAt(dir, fs)?.name;
		if (name !== undefined) return name;
		if (path.dirname(dir) === dir) return undefined;
	}
}

/** Returns the name of the nearest package at or above the directory of the file `at`, read from this process's file system. */
export const packageNameOf = (at: string): string | undefined => packageNameAt(at, nodeFS);

/** Returns the directory of the package `pkgName`, as Node finds it from `from`: the nearest directory at or above `from` that is that
 *  package, since a package names itself from inside it, or that holds it in its node_modules. Throws where a directory at or above
 *  `from` doesn't hold it. */
function packageDir(pkgName: string, from: string, fs: Pick<TFileSystem, "existsSync" | "readFileSync">): string {
	for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
		if (packageJsonAt(dir, fs)?.name === pkgName) return dir;
		const installed = path.join(dir, "node_modules", pkgName);
		if (packageJsonAt(installed, fs) !== undefined) return installed;
		if (path.dirname(dir) === dir) throw new Error(`the package ${pkgName} isn't installed at or above ${from}, and isn't a package there; install it in the workspace`);
	}
}

/** Returns where a package exports `subpath`, as Node maps it: the exact export, else the pattern with the longest prefix, each at its
 *  `default` branch, which the compiled output takes where the `haibun-source` condition is inactive. A package without an exports map
 *  exports every path in its directory. Throws where the exports map doesn't cover the subpath. */
function exportedPath(pkgDir: string, pkgName: string, subpath: string, exports: Record<string, TExportTarget> | undefined): string {
	if (exports === undefined) return path.join(pkgDir, subpath);
	const target = (t: TExportTarget): string => {
		const chosen = typeof t === "string" ? t : (t.default ?? t.node ?? t.require ?? t.import ?? Object.values(t)[0]);
		if (chosen === undefined) throw new Error(`package ${pkgName} exports a condition map without a target for subpath ${subpath}`);
		return chosen;
	};
	const exact = exports[subpath] || exports[`${subpath}.js`];
	if (exact) return path.join(pkgDir, target(exact));
	const patterns = Object.entries(exports)
		.filter(([pattern]) => pattern.endsWith("/*") && subpath.startsWith(pattern.slice(0, -1)))
		.sort(([a], [b]) => b.length - a.length);
	const [matched] = patterns;
	if (matched === undefined) throw new Error(`package ${pkgName} exports map does not cover subpath ${subpath}`);
	const [pattern, patternTarget] = matched;
	return path.join(pkgDir, target(patternTarget).replace("*", subpath.slice(pattern.length - 1)));
}

/** Returns the file or directory a package export names, such as `@haibun/cli/config.base.json`, as Node finds the package from `from`. */
export function packageLocation(name: string, from: string, fs: Pick<TFileSystem, "existsSync" | "readFileSync">): string {
	const parts = name.split("/");
	const pkgName = `${parts[0]}/${parts[1]}`;
	const pkgDir = packageDir(pkgName, from, fs);
	if (parts.length === 2) return pkgDir;
	return exportedPath(pkgDir, pkgName, `./${parts.slice(2).join("/")}`, packageJsonAt(pkgDir, fs)?.exports);
}

export function getModuleLocation(name: string) {
	if (name.startsWith(".")) {
		return path.resolve(process.cwd(), name);
	} else if (namesPackage(name)) {
		return packageLocation(name, process.cwd(), nodeFS);
	} else if (name.match(/^[a-zA-Z].*/)) {
		return path.join(CORE_STEPS_DIR, name);
	}
	return path.resolve(workspaceRoot, name);
}

async function getStepper(s: string) {
	try {
		const loc = getModuleLocation(s);
		const S: CStepper = await use(loc);
		return S;
	} catch (e) {
		console.error(`could not use ${s}`);
		throw e;
	}
}
