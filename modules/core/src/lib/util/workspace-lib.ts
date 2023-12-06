import nodeFS from 'fs';
import path, { dirname } from 'path';

import {
  IResultOutput,
  TExecutorResult, CStepper, DEFAULT_DEST, TBase, TSpecl
} from '../defs.js';
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
// const workspaceRoot = workspaceRootInner(process.cwd(), process.cwd());
export const workspaceRoot = getWorkspaceRoot();

type TImportMeta = { url: string }

export function getPackageLocation(meta: TImportMeta) {
  return dirname(fileURLToPath(meta.url));
}

export const getFilename = (meta: TImportMeta) => fileURLToPath(meta.url);
export const getDirname = (meta: TImportMeta) => fileURLToPath(new URL('.', meta.url));

function getWorkspaceRoot() {
  return process.cwd();
}

export function getModuleLocation(name: string) {
  if (name.startsWith('~')) {
    return [workspaceRoot, 'node_modules', name.substring(1)].join('/');
  } else if (name.match(/^[a-zA-Z].*/)) {
    return `../../steps/${name}`;
  }
  return path.resolve(workspaceRoot, name);
}

export async function getOutputResult(type: string | undefined, result: TExecutorResult): Promise<object | string> {
  if (type) {
    const loc = getModuleLocation(type);
    const AnOut = await use(loc);
    const out: IResultOutput = new AnOut();
    if (out) {
      const res = await out.writeOutput(result, {});
      return res;
    }
  }
  return result;
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

export function getConfigFromBase(bases: TBase, fs: TFileSystem = nodeFS): TSpecl | null {
  const found = bases.filter((b) => fs.existsSync(`${b}/config.json`));
  if (found.length > 1) {
    console.error(`Found multiple config.json files: ${found.join(', ')}. Use --config to specify one.`);
    return null;
  }
  const configDir = found[0] || '.';
  const f = `${configDir}/config.json`;
  console.info(`trying ${f}`);
  try {
    const specl = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (!specl.options) {
      specl.options = { DEST: DEFAULT_DEST };
    }
    return specl;
  } catch (e) {
    return null;
  }
}
