import { existsSync } from 'fs';
import { TSpecl, IStepper, notOk, IStepperConstructor, TResult } from './defs';
import { expandBackgrounds, expandFeatures } from './features';
import { Investigator } from './investigator/Investigator';
import { parse } from './parse';
import { Resolver } from './Resolver';
import { getSteppers, recurse } from './util';

export async function run({ specl, base, addSteppers = [] }: { specl: TSpecl; base: string; addSteppers?: IStepperConstructor[] }): Promise<TResult> {
  const shared = {};
  const features = await recurse(`${base}/features`, 'feature', {});

  const backgrounds = existsSync(`${base}/backgrounds`) ? await recurse(`${base}/backgrounds`, 'feature', {}) : {};
  const steppers: IStepper[] = await getSteppers(specl.steppers, shared, addSteppers);
  if (specl.refs) {
    await parse(specl, base, steppers);
  }
  const expandedBackgrounds = await expandBackgrounds(backgrounds);
  const expandedFeatures = await expandFeatures(features, expandedBackgrounds);

  const resolver = new Resolver(steppers, specl);
  let mappedValidatedSteps;
  try {
    mappedValidatedSteps = await resolver.resolveSteps(expandedFeatures);
  } catch (error) {
    return { ...notOk, failure: { stage: 'Resolver', error } };
  }

  const investigator = new Investigator(steppers, specl);
  const res = await investigator.investigate(mappedValidatedSteps);
  return res;
}
