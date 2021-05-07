import { existsSync, writeFileSync } from 'fs';
import { TSpecl, IStepper, ok, notOk } from './defs';
import { Investigator } from './investigator/Investigator';
import { parse } from './parse';
import { getSteppers, recurse } from './util';

export async function run(specl: TSpecl, base: string) {
  const shared = {};
  const features = await recurse(`${base}/features`, 'feature', {});

  const backgrounds = existsSync(`${base}/backgrounds`) ? await recurse(`${base}/backgrounds`, 'feature', {}) : {};
  const steppers: IStepper[] = await getSteppers(specl.steppers, shared);
  if (specl.refs) {
    await parse(specl, base, steppers);
  }
  const investigator = new Investigator(steppers, specl);
  writeFileSync('paths.json', JSON.stringify({ features, backgrounds }, null, 2));
  try {
    return await investigator.investigate(features, backgrounds);
  } catch (e) {
    return { ...notOk };
  }
}
