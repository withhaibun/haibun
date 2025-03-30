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
	return process.cwd().replace(/haibun\/modules\/[^/]*$/, 'haibun');
}

export function getModuleLocation(name: string) {
	if (name.startsWith('~')) {
		return [workspaceRoot, 'node_modules', name.substring(1)].join('/');
	} else if (name.match(/^[a-zA-Z].*/)) {
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
