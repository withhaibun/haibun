import { existsSync } from 'fs';
import { TSpecl, IStepper, notOk, IStepperConstructor, TResult, TPaths } from './defs';
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

  let expandedFeatures;
  try {
    expandedFeatures = await expand(backgrounds, features);
  } catch (error) {
    return { ...notOk, failure: { stage: 'Expand', error: error.message } };
  }

  let mappedValidatedSteps;
  try {
    const resolver = new Resolver(steppers, specl);
    mappedValidatedSteps = await resolver.resolveSteps(expandedFeatures);
  } catch (error) {
    return { ...notOk, failure: { stage: 'Resolve', error: { details: error.message, context: { steppers, mappedValidatedSteps } } } };
  }

  const investigator = new Investigator(steppers, specl);
  const res = await investigator.investigate(mappedValidatedSteps);
  return res;
}

async function expand(backgrounds: TPaths, features: TPaths) {
  const expandedBackgrounds = await expandBackgrounds(backgrounds);

  const expandedFeatures = await expandFeatures(features, expandedBackgrounds);
  return expandedFeatures;
}
