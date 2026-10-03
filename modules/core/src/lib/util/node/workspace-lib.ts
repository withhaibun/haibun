import path, { dirname } from "path";
import nodeFS from "fs";

import { type TStepperEntry } from "../../execution.js";
import { CStepper } from "../../astepper.js";
import { use } from "./module-loader.js";
import { fileURLToPath } from "url";
import { RemoteStepperProxy } from "../../remote-stepper-proxy.js";

/** The file-system calls feature collection and workspace discovery make, which a test gives in place of node's. */
export type TFileSystem = Pick<typeof nodeFS, "existsSync" | "readdirSync" | "statSync" | "readFileSync">;
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
			steppers.push(
				class extends RemoteStepperProxy {
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

const pkgJsonCache = new Map<string, Record<string, unknown>>();

/** Resolved at module init to avoid repeated fileURLToPath + path.resolve on every stepper load.
 *  Uses getPackageLocation so the path is correct whether core is a linked/installed dependency
 *  (build/steps) or the current workspace in src mode (src/steps). */
const CORE_STEPS_DIR = path.resolve(getPackageLocation(import.meta), "../../../steps");

export function getModuleLocation(name: string) {
	if (name.startsWith(".")) {
		return path.resolve(process.cwd(), name);
	} else if (name.startsWith("@")) {
		const parts = name.split("/");
		const pkgName = `${parts[0]}/${parts[1]}`;
		const pkgDir = [workspaceRoot, "node_modules", pkgName].join("/");
		if (parts.length === 2) return pkgDir;
		const subpath = `./${parts.slice(2).join("/")}`;
		const pkgJsonPath = path.join(pkgDir, "package.json");
		if (!nodeFS.existsSync(pkgJsonPath)) throw new Error(`package ${pkgName} not found at ${pkgDir}`);
		const pkg: Record<string, unknown> = pkgJsonCache.get(pkgJsonPath) ?? JSON.parse(nodeFS.readFileSync(pkgJsonPath, "utf-8"));
		pkgJsonCache.set(pkgJsonPath, pkg);
		const exports = pkg.exports as Record<string, string | Record<string, string>> | undefined;
		if (!exports) throw new Error(`package ${pkgName} doesn't have an exports map, so subpath ${subpath} doesn't resolve`);
		// A conditional export (e.g. "./*": { "haibun-source": "./src/*", default: "./build/*" }) is an object, not a string.
		// The Node-side stepper loader runs compiled output, so resolve to the `default` (build) branch, mirroring plain
		// Node resolution where the custom `haibun-source` condition is inactive unless --conditions=haibun-source is passed.
		const condTarget = (t: string | Record<string, string>): string => {
			const target = typeof t === "string" ? t : (t.default ?? t.node ?? t.require ?? t.import ?? Object.values(t)[0]);
			if (target === undefined) throw new Error(`package ${pkgName} exports a condition map without a target for subpath ${subpath}`);
			return target;
		};
		const exact = exports[subpath] || exports[`${subpath}.js`];
		if (exact) return path.join(pkgDir, condTarget(exact));
		for (const [pattern, target] of Object.entries(exports)) {
			if (pattern.endsWith("/*")) {
				const prefix = pattern.slice(0, -1);
				if (subpath.startsWith(prefix)) return path.join(pkgDir, condTarget(target).replace("*", subpath.slice(prefix.length)));
			}
		}
		throw new Error(`package ${pkgName} exports map does not cover subpath ${subpath}`);
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
