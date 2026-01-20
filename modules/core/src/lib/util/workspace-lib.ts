import path, { dirname } from 'path';
import nodeFS from 'fs';

import { CStepper } from '../defs.js';
import { use } from './index.js';
import { fileURLToPath } from 'url';

export type TFileSystem = Partial<typeof nodeFS>;
export async function getSteppers(stepperNames: string[]) {
	const steppers: CStepper[] = [];
	for (const s of stepperNames) {
		try {
			const S = await getStepper(s);
			steppers.push(S);
		} catch (e) {
			console.error(`get ${s} from "${getModuleLocation(s)}" failed`, e);
			throw e;
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
export const getDirname = (meta: TImportMeta) => fileURLToPath(new URL('.', meta.url));

function getWorkspaceRoot() {
	let currentDir = path.resolve(process.cwd());
	const tried: string[] = [];

	// eslint-disable-next-line no-constant-condition
	while (true) {
		tried.push(currentDir);
		const packageJsonPath = path.resolve(currentDir, 'package.json');

		if (nodeFS.existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(nodeFS.readFileSync(packageJsonPath, 'utf-8'));
				if (packageJson.name === 'haibun') {
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
	if (name.startsWith('.')) {
		return path.resolve(process.cwd(), name);
	} else if (name.startsWith('@')) {
		// @scoped package - resolve to node_modules
		const parts = name.split('/');
		return [workspaceRoot, 'node_modules', ...parts].join('/');
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
