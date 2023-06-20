import nodeFS from 'fs';
import path from 'path';

import {
  IHasOptions,
  TNotOKActionResult,
  TOKActionResult,
  IResultOutput,
  TExecutorResult,
  TSpecl,
  TWorld,
  TRuntime,
  TActionResultTopics,
  TActionResult,
  TFound,
  TTag,
  AStepper,
  TExtraOptions,
  CStepper,
  DEFAULT_DEST,
  TTagValue,
  TFeatureResult,
  TBase,
} from '../defs.js';
import { Timer } from '../Timer.js';

type TClass = { new <T>(...args: unknown[]): T };
export type TFileSystem = Partial<typeof nodeFS>;

export const basesFrom = (s): string[] => s.split(',').map(b => b.trim());

// FIXME tired of wrestling with ts/import issues
export async function use(module: string): Promise<TClass> {
  try {
    const re: object = (await import(`${module}.js`)).default;
    checkModuleIsClass(re, module);
    return <TClass>re;
  } catch (e) {
    console.error('failed including', module);
    throw e;
  }
}

export function checkModuleIsClass(re: object, module: string) {
  // this is early morning code
  const type = re?.toString().replace(/^ /g, '').split('\n')[0].replace(/\s.*/, '');

  if (type !== 'class') {
    throw Error(`"${module}" is ${type}, not a class`);
  }
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
  if (!result.ok) {
    const failedResults = result.featureResults?.filter((r) => !r.ok).map((r) => (r.stepResults = r.stepResults.filter((s) => !s.ok)));
    return { ...result, featureResults: failedResults };
  }
  return result;
}

export function actionNotOK(message: string, also?: { error?: Error, topics?: TActionResultTopics; score?: number }): TNotOKActionResult {
  return {
    ok: false,
    message,
    ...also,
  };
}

export function actionOK(topics?: TActionResultTopics): TOKActionResult {
  return { ok: true, topics };
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

export async function createSteppers(steppers: CStepper[]): Promise<AStepper[]> {
  const allSteppers: AStepper[] = [];
  for (const S of steppers) {
    try {
      const stepper = new S();
      allSteppers.push(stepper);
    } catch (e) {
      console.error(`create ${S} failed`, e, S);
      throw e;
    }
  }
  return allSteppers;
}

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

// workspaceRoot adapted from @nrwl/devkit
const workspaceRoot = workspaceRootInner(process.cwd(), process.cwd());
function workspaceRootInner(dir, candidateRoot, fs: TFileSystem = nodeFS) {
  if (path.dirname(dir) === dir) {
    return candidateRoot;
  }
  if (fs.existsSync(path.join(dir, 'nx.json'))) {
    return dir;
  } else if (fs.existsSync(path.join(dir, 'node_modules', 'nx', 'package.json'))) {
    return workspaceRootInner(path.dirname(dir), dir);
  } else {
    return workspaceRootInner(path.dirname(dir), candidateRoot);
  }
}

function getModuleLocation(name: string) {
  if (name.startsWith('~')) {
    return [workspaceRoot, 'node_modules', name.substr(1)].join('/');
  } else if (name.match(/^[a-zA-Z].*/)) {
    return `../../steps/${name}`;
  }
  return path.resolve(process.cwd(), name);
}


export function getDefaultOptions(): TSpecl {
  return {
    mode: 'all',
    steppers: ['vars'],
    options: { DEST: DEFAULT_DEST },
  };
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

export function getActionable(value: string) {
  return value.replace(/#.*/, '').trim();
}

export function describeSteppers(steppers: AStepper[]) {
  return steppers
    ?.map((stepper) => {
      return `${stepper.constructor.name}: ${Object.keys(stepper?.steps).sort().join('|')}`;
    }).sort().join('  ');
}

// from https://stackoverflow.com/questions/1027224/how-can-i-test-if-a-letter-in-a-string-is-uppercase-or-lowercase-using-javascrip
export function isLowerCase(str: string) {
  return str.toLowerCase() && str != str.toUpperCase();
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// has side effects
export async function verifyExtraOptions(inExtraOptions: TExtraOptions, csteppers: CStepper[]) {
  const extraOptions = { ...inExtraOptions };
  Object.entries(extraOptions)?.map(([k, v]) => {
    const conc = getStepperOptionValue(k, v, csteppers);

    if (conc === undefined) {
      throw Error(`no option ${k} from ${JSON.stringify(extraOptions)}`);
    }
    delete extraOptions[k];
  });

  if (Object.keys(extraOptions).length > 0) {
    throw Error(`no options provided for ${extraOptions}`);
  }
}

export async function setStepperWorlds(steppers: AStepper[], world: TWorld) {
  for (const stepper of steppers) {
    try {
      await stepper.setWorld(world, steppers);
    } catch (e) {
      console.error(`setWorldStepperOptions ${stepper.constructor.name} failed`, e);
      throw e;
    }
  }
}
export function getPre(stepper: AStepper) {
  return ['HAIBUN', 'O', stepper.constructor.name.toUpperCase()].join('_') + '_';
}
export function getStepperOptionValue(key: string, value: string, csteppers: CStepper[]) {
  for (const cstepper of csteppers) {
    const pre = getPre(cstepper.prototype);
    const name = key.replace(pre, '');
    const ao = new cstepper() as IHasOptions;

    if (key.startsWith(pre)) {
      if (!ao.options) {
        throw Error(`${cstepper.name} has no options`);
      }

      if (ao.options[name]) {
        return ao.options[name].parse(value);
      } else {
        throw Error(`${cstepper.name} has no option ${name}`);
      }
    }
  }
}

export async function verifyRequiredOptions(steppers: CStepper[], options: TExtraOptions) {
  const requiredMissing: string[] = [];
  for (const Stepper of steppers) {
    const stepper = new Stepper();

    const ao = stepper as IHasOptions;

    for (const option in ao.options) {
      const n = getStepperOptionName(stepper, option);
      if (ao.options[option].required && !options[n]) {
        requiredMissing.push(n);
      }
    }
  }
  if (requiredMissing.length) {
    console.log(process.env)
    throw Error(`missing required options ${requiredMissing}`);
  }
}

export function getStepperOptionName(stepper: AStepper | CStepper, name: string) {
  if ((stepper as CStepper).prototype) {
    return getPre((stepper as CStepper).prototype) + name;
  }
  return getPre(stepper as AStepper) + name;
}

export function getStepperOption(stepper: AStepper, name: string, extraOptions: TExtraOptions) {
  const key = getStepperOptionName(stepper, name);
  return extraOptions[key];
}

export function findStepperFromOption<Type>(steppers: AStepper[], stepper: AStepper, extraOptions: TExtraOptions, ...name: string[]): Type {
  const val = name.reduce<string | undefined>((v, n) => v || getStepperOption(stepper, n, extraOptions), undefined);

  if (!val) {
    throw Error(`Cannot find ${name} from ${stepper.constructor.name} options`);
  }
  return findStepper(steppers, val);
}

export function findStepper<Type>(steppers: AStepper[], name: string): Type {
  const stepper = <Type>(steppers.find((s) => s.constructor.name === name) as any);
  if (!stepper) {
    // FIXME does not cascade
    throw Error(
      `Cannot find ${name} from ${JSON.stringify(
        steppers.map((s) => s.constructor.name),
        null,
        2
      )}`
    );
  }
  return stepper;
}

export function getFromRuntime<Type>(runtime: TRuntime, name: string): Type {
  return runtime[name] as Type;
}

export function applyResShouldContinue(world: any, res: Partial<TActionResult>, vstep: TFound): boolean {
  const { score, message } = res as TNotOKActionResult;
  if (res.ok) {
    return true;
  }
  if (world.options.continueOnErrorIfScored && score !== undefined) {
    const calc = { score, message, action: vstep };

    world.shared.values._scored.push(calc);
    return true;
  }
  return false;
}

export const getRunTag = (sequence: TTagValue, loop: TTagValue, featureNum: TTagValue, member: TTagValue, params = {}, trace = false) => {
  const when = Timer.startTime.getTime();
  const res: TTag = { when, sequence, loop, member, featureNum, params, trace };
  ['when', 'sequence', 'loop', 'member', 'featureNum'].forEach((w) => {
    const val = (res as any)[w];
    if (parseInt(val) !== val) {
      throw Error(`missing ${w} from ${JSON.stringify(res)}`);
    }
  });
  return res;
};

export const descTag = (tag: TTag) => ` @${tag.sequence} (${tag.loop}x${tag.member})`;
export const isFirstTag = (tag: TTag) => tag.sequence === 0 && tag.loop === 1 && tag.member === 0;

export const intOrError = (val: string) => {
  if (val.match(/[^\d+]/)) {
    return { error: `${val} is not an integer` };
  }
  return { result: parseInt(val, 10) };
};

export const boolOrError = (val: string) => {
  if (val !== 'false' && val !== 'true') {
    return { error: `${val} is not true or false` };
  }
  return { result: val === 'true' };
};

export const stringOrError = (val: string) => {
  if (val === undefined || val === null) {
    return { error: `${val} is not defined` };
  }
  return { result: val };
};

export const optionOrError = (val: string, options: string[]) => {
  if (val === undefined || val === null || !options.includes(val)) {
    return { error: `"${val}" is not defined or not one of ${JSON.stringify(options)}` };
  }
  return { result: val };
};

export function friendlyTime(d: Date) {
  return new Date(d).toLocaleString();
}

export const shortNum = (n: number) => Math.round(n * 100) / 100;

export const getFeatureTitlesFromResults = (result: TFeatureResult) =>
  result.stepResults.filter((s) => s.actionResults.find((a) => (a.name === 'feature' ? true : false))).map((a) => a.in.replace(/^Feature: /, ''));

export function trying<TResult>(fun: () => void): Promise<Error | TResult> {
  return new Promise((resolve, reject) => {
    try {
      const res = <TResult>fun();
      return resolve(res);
    } catch (e: unknown) {
      // https://kentcdodds.com/blog/get-a-catch-block-error-message-with-typescript
      return reject(asError(e));
    }
  });
}

export function asError(e: unknown): Error {
  return typeof e === 'object' && e !== null && 'message' in e && typeof (e as Record<string, unknown>).message === 'string' ? (e as Error) : new Error(e as any);
}

export const getSerialTime = () => Date.now();

export function dePolite(s: string) {
  return s.replace(/^((given|when|then|and|should|the|it|I'm|I|am|an|a) )*/i, '');
}
