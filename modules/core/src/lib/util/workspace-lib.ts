import path, { dirname } from "path";
import nodeFS from "fs";

import { CStepper, type TStepperEntry } from "../defs.js";
import { use } from "./index.js";
import { fileURLToPath } from "url";
import { RemoteStepperProxy } from "../remote-stepper-proxy.js";

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

export function getModuleLocation(name: string) {
	if (name.startsWith(".")) {
		return path.resolve(process.cwd(), name);
	} else if (name.startsWith("@")) {
		// @scoped package - resolve to node_modules
		const parts = name.split("/");
		return [workspaceRoot, "node_modules", ...parts].join("/");
	} else if (name.match(/^[a-zA-Z].*/)) {
		// Core stepper name (e.g., "variables-stepper")
		return `../../steps/${name}`;
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
