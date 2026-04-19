import path, { dirname } from "path";
import nodeFS from "fs";

import { CStepper, type TStepperEntry } from "../../execution.js";
import { use } from "./module-loader.js";
import { fileURLToPath } from "url";
import { RemoteStepperProxy } from "../../remote-stepper-proxy.js";

export type TFileSystem = Partial<typeof nodeFS>;
export async function getSteppers(stepperEntries: TStepperEntry[]) {
	const steppers: CStepper[] = [];
	for (const entry of stepperEntries) {
		if (typeof entry === "string") {
			try {
				const S = await getStepper(entry);
				steppers.push(S);
			} catch (e) {
				console.error(`get ${entry} from "${getModuleLocation(entry)}" failed`, e);
				throw e;
			}
		} else {
			// Remote stepper: create a factory that returns a pre-configured RemoteStepperProxy
			const { remote, token } = entry;
			steppers.push(
				class extends RemoteStepperProxy {
					constructor() {
						super(remote, token);
					}
				} as unknown as CStepper,
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

export const getFilename = (meta: TImportMeta) => fileURLToPath(meta.url);
export const getDirname = (meta: TImportMeta) => fileURLToPath(new URL(".", meta.url));

function getWorkspaceRoot() {
	let currentDir = path.resolve(process.cwd());
	const tried: string[] = [];

	// eslint-disable-next-line no-constant-condition
	while (true) {
		tried.push(currentDir);
		const packageJsonPath = path.resolve(currentDir, "package.json");

		if (nodeFS.existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(nodeFS.readFileSync(packageJsonPath, "utf-8"));
				if (packageJson.name === "haibun") {
					return currentDir;
				}
			} catch {
				// Ignore JSON parse errors and continue searching
			}
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}

	// Fallback to process.cwd() for external projects, matching previous behavior.
	return process.cwd();
}

const pkgJsonCache = new Map<string, Record<string, unknown>>();

/** Resolved at module init to avoid repeated fileURLToPath + path.resolve on every stepper load.
 *  From build/lib/util/node/workspace-lib.js, "../../../steps" points at build/steps/. */
const CORE_STEPS_DIR = path.resolve(dirname(fileURLToPath(import.meta.url)), "../../../steps");

export function getModuleLocation(name: string) {
	if (name.startsWith(".")) {
		return path.resolve(process.cwd(), name);
	} else if (name.startsWith("@")) {
		// @scoped package — resolve subpath through exports map if available
		const parts = name.split("/");
		const pkgName = `${parts[0]}/${parts[1]}`;
		const pkgDir = [workspaceRoot, "node_modules", pkgName].join("/");
		const rawPath = [workspaceRoot, "node_modules", ...parts].join("/");
		if (parts.length > 2) {
			// If the raw path resolves directly (e.g. @haibun/pkg/build/foo), use it
			if (nodeFS.existsSync(`${rawPath}.js`) || nodeFS.existsSync(rawPath)) return rawPath;
			// Otherwise resolve through exports map
			const subpath = `./${parts.slice(2).join("/")}`;
			const pkgJsonPath = path.join(pkgDir, "package.json");
			if (nodeFS.existsSync(pkgJsonPath)) {
				try {
					let pkg = pkgJsonCache.get(pkgJsonPath);
					if (!pkg) {
						pkg = JSON.parse(nodeFS.readFileSync(pkgJsonPath, "utf-8"));
						pkgJsonCache.set(pkgJsonPath, pkg);
					}
					const exports = (pkg as Record<string, unknown>).exports as Record<string, string> | undefined;
					if (exports) {
						const exact = exports[subpath] || exports[`${subpath}.js`];
						if (exact) return path.join(pkgDir, exact);
						for (const [pattern, target] of Object.entries(exports)) {
							if (pattern.endsWith("/*")) {
								const prefix = pattern.slice(0, -1);
								if (subpath.startsWith(prefix)) return path.join(pkgDir, target.replace("*", subpath.slice(prefix.length)));
							}
						}
					}
				} catch {
					/* fall through to raw path */
				}
			}
		}
		return rawPath;
	} else if (name.match(/^[a-zA-Z].*/)) {
		return path.join(CORE_STEPS_DIR, name);
	}
	return path.resolve(workspaceRoot, name);
}

export async function getStepper(s: string) {
	try {
		const loc = getModuleLocation(s);
		const S: CStepper = await use(loc);
		return S;
	} catch (e) {
		console.error(`could not use ${s}`);
		throw e;
	}
}
