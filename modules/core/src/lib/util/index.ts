import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';

import {
  IHasOptions,
  TFeature,
  TNotOKActionResult,
  TOKActionResult,
  TOptionValue,
  TResultOutput,
  TResult,
  TSpecl,
  TWorld,
  TOptions,
  TRuntime,
  TActionResultTopics,
  TActionResult,
  TFound,
  TTag,
  AStepper,
  TExtraOptions,
  StringOrNumber,
  TFeatureResult,
} from '../defs';
import { withNameType } from '../features';

// FIXME tired of wrestling with ts/import issues
export async function use(module: string) {
  try {
    const re: any = (await import(module)).default;
    return re;
  } catch (e) {
    console.error('failed including', module);
    console.error(e);
    throw e;
  }
}

export async function resultOutput(type: string | undefined, result: TResult) {
  if (type) {
    const AnOut = await use(type);
    const out: TResultOutput = new AnOut();
    if (out) {
      const res = await out.writeOutput(result, {});
      return res;
    }
  }
  if (!result.ok) {
    return { ...result, results: result.results?.filter((r) => !r.ok).map((r) => (r.stepResults = r.stepResults.filter((s) => !s.ok))) };
  }
  return result;
}

export function actionNotOK(message: string, also?: { topics?: TActionResultTopics; score?: number }): TNotOKActionResult {
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

    const S: AStepper = await use(loc);

    return S;
  } catch (e) {
    console.error(`could not use ${s}`);
    throw (e);
  }
}

export async function getSteppers({ steppers = [], addSteppers = [] }: { steppers: string[]; addSteppers?: typeof AStepper[] }) {
  const allSteppers: AStepper[] = [];
  for (const s of steppers) {
    const S = await getStepper(s);
    try {
      const stepper = new (S as any)();
      allSteppers.push(stepper);
    } catch (e) {
      console.error(`new ${S} from "${getModuleLocation(s)}" failed`, e, S);
      throw e;
    }
  }
  for (const S of addSteppers) {
    const stepper = new (S as any)();
    allSteppers.push(stepper);
  }
  return allSteppers;
}

function getModuleLocation(name: string) {
  if (name.startsWith('~')) {
    return [process.cwd(), 'node_modules', name.substr(1)].join('/');
  } else if (name.match(/^[a-zA-Z].*/)) {
    return `../../steps/${name}`;
  }
  return path.resolve(process.cwd(), name);
}

export function debase(base: string, features: TFeature[]) {
  return features.map((f) => ({ ...f, path: f.path.replace(base, '') }));
}

export function recurse(dir: string, type: string, featureFilter: string[] | undefined = undefined): TFeature[] {
  const files = readdirSync(dir);
  let all: TFeature[] = [];
  for (const file of files) {
    const here = `${dir}/${file}`;

    if (statSync(here).isDirectory()) {
      all = all.concat(recurse(here, type, featureFilter));
    } else if (shouldProcess(here, type, featureFilter)) {
      all.push(withNameType(here, readFileSync(here, 'utf-8')));
    }
  }
  return all;
}

export function shouldProcess(file: string, type: undefined | string, featureFilter: string[] | undefined) {
  const isType = (!type || file.endsWith(`.${type}`));
  const matchesFilter = featureFilter ? !!(featureFilter.find(f => file.match(f))) : true;

  return (isType && matchesFilter);
}

export function getDefaultOptions(): TSpecl {
  return {
    mode: 'all',
    steppers: ['vars'],
    options: {},
  };
}

export function getConfigFromBase(base: string): TSpecl | null {
  const f = `${base}/config.json`;
  try {
    const specl = JSON.parse(readFileSync(f, 'utf-8'));
    if (!specl.options) {
      specl.options = {};
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
  return steppers?.map((stepper) => {
    return stepper.steps && Object.keys(stepper?.steps).map((name) => {
      return `${stepper.constructor.name}:${name}`;
    });
  })
    .join(' ');
}

// from https://stackoverflow.com/questions/1027224/how-can-i-test-if-a-letter-in-a-string-is-uppercase-or-lowercase-using-javascrip
export function isLowerCase(str: string) {
  return str.toLowerCase() && str != str.toUpperCase();
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


// has side effects
export async function applyExtraOptions(extraOptions: TExtraOptions, steppers: AStepper[], world: TWorld) {
  if (!extraOptions) {
    return;
  }

  Object.entries(extraOptions).map(([k, v]) => {
    const conc = getStepperOptions(k, v!, steppers);

    if (conc === undefined) {
      throw Error(`no option ${k}`);
    }
    delete extraOptions[k];
    world.options[k] = conc.result;
  });

  if (Object.keys(extraOptions).length > 0) {
    throw Error(`no options provided for ${extraOptions}`);
  }
  for (const stepper of steppers) {
    stepper.setWorld(world, steppers);
  }
}

export function getPre(stepper: AStepper) {
  return ['HAIBUN', 'O', stepper.constructor.name.toUpperCase()].join('_') + '_';
}
export function getStepperOptions(key: string, value: string, steppers: (AStepper & IHasOptions)[]): TOptionValue | void {
  for (const stepper of steppers) {
    const pre = getPre(stepper);
    const int = key.replace(pre, '');

    if (key.startsWith(pre) && stepper.options![int]) {
      return stepper.options![int].parse(value);
    }
  }
}

export async function verifyRequiredOptions(steppers: (AStepper & IHasOptions)[], options: TExtraOptions) {
  let requiredMissing = [];
  for (const stepper of steppers) {
    for (const option in stepper.options) {
      const n = getStepperOptionName(stepper, option);
      if (stepper.options[option].required && !options[n]) {
        requiredMissing.push(n);
      }
    }
  }
  if (requiredMissing.length) {
    throw Error(`missing required options ${requiredMissing}`)
  }
}

export function getStepperOptionName(stepper: AStepper, name: string) {
  return getPre(stepper) + name;
}

export function getStepperOption(stepper: AStepper, name: string, options: TOptions): TOptionValue {
  const key = getStepperOptionName(stepper, name);
  return options[key];
}

export function ensureDirectory(base: string, folder: string) {
  try {
    if (!existsSync(base)) {
      mkdirSync(base);
      console.info(`created ${base}`);
    }
    if (!existsSync(`${base}/${folder}`)) {
      mkdirSync(`${base}/${folder}`);
      console.info(`created ${base}/${folder}`);
    }
  } catch (e) {
    console.error(`could not create ${base}/${folder}`, e);
    throw e;
  }
}

// FIXME
export function findStepper<Type>(steppers: AStepper[], name: string): Type {
  return <Type>(steppers.find((s) => s.constructor.name === name) as any);
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

export function getCaptureDir({ options, tag }: { options: TOptions, tag: TTag }, app?: string) {
  const p = [options.base, options.CAPTURE_DIR || 'capture', `loop-${tag.loop}`, `seq-${tag.sequence}`, `featn-${tag.featureNum}`, `mem-${tag.member}`];
  app && p.push(app);
  return '.' + p.join('/');
}

export function writeFeatureTraceFile(world: TWorld, result: TFeatureResult) {
  const dir = ensureCaptureDir(world, 'trace', `trace.json`);
  writeFileSync(dir, JSON.stringify(result, null, 2));
}

export function writeTraceFile(world: TWorld, result: TResult) {
  const dir = ensureCaptureDir(world, 'trace', `trace.json`);
  writeFileSync(dir, JSON.stringify(result, null, 2));
}

export function ensureCaptureDir(world: TWorld, app: string, fn = '') {
  const dir = getCaptureDir(world, app);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      throw Error(`creating ${dir}: ${e}`)
    }
  }
  return `${dir}/${fn}`;
}

export const getRunTag = (sequence: StringOrNumber, loop: StringOrNumber, member: StringOrNumber, featureNum: StringOrNumber, params = {}, trace = false) => ({ sequence, loop, member, featureNum, params, trace });

export const descTag = (tag: TTag) => ` @${tag.sequence} (${tag.loop}x${tag.member})`;

export const intOrError = (val: string) => {
  if (val.match(/[^\d+]/)) {
    return { error: `${val} is not an integer` };
  }
  return { result: parseInt(val, 10) };
}

export const boolOrError = (val: string) => {
  if (val !== 'false' && val !== 'true') {
    return { error: `${val} is not true or false` }
  };
  return { result: val === 'true' }
};

export const stringOrError = (val: string) => {
  if (val === undefined || val === null) {
    return { error: `${val} is not defined` }
  };
  return { result: val }
};
