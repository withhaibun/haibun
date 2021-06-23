import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { IStepper, IStepperConstructor, TFeature, TLogger, TNotOKActionResult, TOKActionResult, TOutput, TResult, TRuntime, TShared, TSpecl } from './defs';

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

export function actionOK(): TOKActionResult {
  return { ok: true };
}

export async function getSteppers({
  steppers = [],
  shared,
  logger,
  addSteppers = [],
  runtime = {},
}: {
  steppers: string[];
  shared: TShared;
  logger: TLogger;
  addSteppers?: IStepperConstructor[];
  runtime?: TRuntime;
}) {
  const allSteppers: IStepper[] = [];
  for (const s of steppers) {
    const loc = s.startsWith('.') ? s : `../steps/${s}`;
    const S: IStepperConstructor = await use(loc);
    const stepper = new S(shared, runtime, logger);
    allSteppers.push(stepper);
  }
  for (const S of addSteppers) {
    const stepper = new S(shared, runtime, logger);
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

const DEFAULT_CONFIG: TSpecl = {
  mode: 'all',
  steppers: ['vars'],
};

export function getConfigOrDefault(base: string): TSpecl {
  const f = `${base}/config.json`;
  if (existsSync(f)) {
    try {
      const specl = JSON.parse(readFileSync(f, 'utf-8'));

      return specl;
    } catch (e) {
      console.error('missing or not valid project config file.');
      process.exit(1);
    }
  }
  return DEFAULT_CONFIG;
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
