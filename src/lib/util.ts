import { existsSync, fstat, readdirSync, readFileSync, statSync } from 'fs';
import { IStepper, IStepperConstructor, notOk, TPaths, TResult, TSpecl, TStep } from './defs';

// FIXME tired of wrestling with ts/import issues
export async function use(module: string) {
  const re: any = (await import(module)).default;
  return re;
}

export async function getSteppers(them: string[] = [], context: any, addSteppers: IStepperConstructor[] = []) {
  const steppers: IStepper[] = [];
  for (const s of them) {
    const S: IStepperConstructor = await use(`../steps/${s}`);
    const stepper = new S(context);
    steppers.push(stepper);
  }
  for (const S of addSteppers) {
    const stepper = new S(context);
    steppers.push(stepper);
  }
  return steppers;
}

export async function recurse(dir: string, type: string, where: any) {
  const files = readdirSync(dir);
  const subdirs = [];
  for (const f of files) {
    const here = `${dir}/${f}`;
    if (statSync(here).isDirectory()) {
      subdirs.push(here);
    } else if (f.endsWith(`.${type}`)) {
      where[f.replace(`.${type}`, '')] = { feature: readFileSync(here, 'utf-8') };
    }
  }
  for (const f of subdirs) {
    const node = {};
    await recurse(f, type, node);
    where[f] = node;
  }
  return where;
}

export function getNamedMatches(what: string, step: TStep) {
  const named = (step.match as RegExp).exec(what)?.groups;
  return named;
}

const DEFAULT_CONFIG: TSpecl = {
  mode: 'all',
  features: {},
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