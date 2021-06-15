import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { IStepper, IStepperConstructor, TFeature, TLogger, TRuntime, TShared, TSpecl, TStep } from './defs';

// FIXME tired of wrestling with ts/import issues
export async function use(module: string) {
  const re: any = (await import(module)).default;
  return re;
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
    const S: IStepperConstructor = await use(`../steps/${s}`);
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
    } else if (filters.every(filter => file.match(filter))) {
      all.push({ path: here.replace(filters[0], ''), feature: readFileSync(here, 'utf-8') });
    }
  }
  return all;
}

export function getNamedMatches(what: string, step: TStep) {
  const named = (step.match as RegExp).exec(what);
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
