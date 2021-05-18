import { existsSync } from 'fs';
import { TSpecl, IStepper, notOk, IStepperConstructor, TResult } from './defs';
import { Investigator } from './investigator/Investigator';
import { parse } from './parse';
import { getSteppers, recurse } from './util';

export async function run({ specl, base, addSteppers = [] }: { specl: TSpecl; base: string; addSteppers?: IStepperConstructor[] }): Promise<TResult> {
  const shared = {};
  const features = await recurse(`${base}/features`, 'feature', {});

  const backgrounds = existsSync(`${base}/backgrounds`) ? await recurse(`${base}/backgrounds`, 'feature', {}) : {};
  const steppers: IStepper[] = await getSteppers(specl.steppers, shared, addSteppers);
  if (specl.refs) {
    await parse(specl, base, steppers);
  }
  const investigator = new Investigator(steppers, specl);
  try {
    const res = await investigator.investigate(features, backgrounds);
    return res;
  } catch (error) {
    return { ...notOk, error };
  }
}
