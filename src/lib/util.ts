import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import {
  IStepper,
  IStepperConstructor,
  IStepperOptions,
  TFeature,
  TNotOKActionResult,
  TOKActionResult,
  TOptionValue,
  TOutput,
  TResult,
  TShared,
  TSpecl,
  TWorld,
  TOptions,
  TProtoOptions,
} from './defs';
import Logger, { LOGGER_NONE } from './Logger';

// FIXME tired of wrestling with ts/import issues
export async function use(module: string) {
  const re: any = (await import(module)).default;
  return re;
}

export async function resultOutput(type: string | undefined, result: TResult, shared: TShared) {
  if (type) {
    let out: TOutput | undefined = undefined;
    if (type === 'AsXUnit') {
      const AsXUnit = (await import('../output/AsXUnit')).default;
      out = new AsXUnit();
    }
    if (out) {
      const res = await out.getOutput(result, {});
      return res;
    }
  }
  if (!result.ok) {
    return { ...result, results: result.results?.filter((r) => !r.ok).map((r) => (r.stepResults = r.stepResults.filter((s) => !s.ok))) };
  }
  return result;
}

export function actionNotOK(message: string, details?: any): TNotOKActionResult {
  return {
    ok: false,
    message,
    details,
  };
}

export function actionOK(details?: any): TOKActionResult {
  return { ok: true, details };
}

export async function getSteppers({ steppers = [], world, addSteppers = [] }: { steppers: string[]; world: TWorld; addSteppers?: IStepperConstructor[] }) {
  const allSteppers: IStepper[] = [];
  for (const s of steppers) {
    const loc = s.startsWith('.') ? s : `../steps/${s}`;
    const S: IStepperConstructor = await use(loc);
    const stepper = new S(world);
    allSteppers.push(stepper);
  }
  for (const S of addSteppers) {
    const stepper = new S(world);
    allSteppers.push(stepper);
  }
  return allSteppers;
}

type TFilters = (string | RegExp)[];

export async function recurse(dir: string, filters: TFilters): Promise<TFeature[]> {
  const files = readdirSync(dir);
  let all: TFeature[] = [];
  for (const file of files) {
    const here = `${dir}/${file}`;
    if (statSync(here).isDirectory()) {
      all = all.concat(await recurse(here, filters));
    } else if (filters.every((filter) => file.match(filter))) {
      all.push({ path: here.replace(filters[0], ''), feature: readFileSync(here, 'utf-8') });
    }
  }
  return all;
}

export function getNamedMatches(regexp: RegExp, what: string) {
  const named = regexp.exec(what);
  return named?.groups;
}

export function getDefaultOptions(): TSpecl {
  return {
    mode: 'all',
    steppers: ['vars'],
    options: {},
  };
}

export function getOptionsOrDefault(base: string): TSpecl {
  const f = `${base}/config.json`;
  if (existsSync(f)) {
    try {
      const specl = JSON.parse(readFileSync(f, 'utf-8'));
      if (!specl.options) {
        specl.options = {};
      }
      return specl;
    } catch (e) {
      console.error('missing or not valid project config file.');
      process.exit(1);
    }
  }
  return getDefaultOptions();
}

export function getActionable(value: string) {
  return value.replace(/#.*/, '').trim();
}

export function describeSteppers(steppers: IStepper[]) {
  return steppers
    .map((stepper) => {
      return Object.keys(stepper.steps).map((name) => {
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

export function getDefaultWorld(): { world: TWorld } {
  return {
    world: {
      shared: {},
      logger: new Logger(LOGGER_NONE),
      runtime: {},
      options: {},
    },
  };
}

export function processEnv(env: { [name: string]: string | undefined }, options: TOptions) {
  const protoOptions: TProtoOptions = { options: { ...options }, extraOptions: {} };
  let splits: TShared[] = [{}];
  Object.entries(env)
    .filter(([k]) => k.startsWith('HAIBUN_'))
    .map(([k, v]) => {
      if (k === 'HAIBUN_SPLIT_SHARED') {
        const [what, s] = v!.split('=');
        splits = s.split(',').map((w: string) => ({ [what]: w }));
      } else if (k === 'HAIBUN_STEP_DELAY') {
        protoOptions.options.step_delay = parseInt(v!, 10);
      } else if (k === 'HAIBUN_CLI') {
        protoOptions.options.cli = true;
      } else {
        protoOptions.extraOptions[k] = v!;
      }
      return {};
    });

  return { splits, protoOptions };
}

// has side effects
export function applyExtraOptions(protoOptions: TProtoOptions, steppers: IStepper[], world: TWorld) {
  if (!protoOptions.extraOptions) {
    return;
  }
  Object.entries(protoOptions.extraOptions).map(([k, v]) => {
    const conc = getStepperOptions(k, v!, steppers);
    if (!conc) {
      throw Error(`no options ${k}`);
    }
    delete protoOptions.extraOptions[k];
    world.options[k] = conc;
  });

  if (Object.keys(protoOptions.extraOptions).length > 0) {
    throw Error(`no options provided for ${protoOptions.extraOptions}`);
  }
}

function getPre(stepper: IStepper) {
  return ['HAIBUN', 'O', (stepper as any as IStepperConstructor).constructor.name.toUpperCase()].join('_') + '_';
}

export function getStepperOptions(key: string, value: string, steppers: (IStepper & IStepperOptions)[]): TOptionValue | void {
  for (const stepper of steppers) {
    const pre = getPre(stepper);
    const int = key.replace(pre, '');
    if (key.startsWith(pre) && stepper.options![int]) {
      return stepper.options![int].parse(value);
    }
  }
}

export function getStepperOption(stepper: IStepper, name: string, options: TOptions): TOptionValue {
  const key = getPre(stepper) + name;
  return options[key];
}
