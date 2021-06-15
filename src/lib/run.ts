import { existsSync } from 'fs';
import { TSpecl, IStepper, notOk, IStepperConstructor, TResult, TLogger, TShared, TRuntime, TFeature, TFeatures } from './defs';
import { expandBackgrounds, expandFeatures } from './features';
import { Investigator } from './investigator/Investigator';
import { parse } from './parse';
import { Resolver } from './Resolver';
import { getSteppers, recurse } from './util';

export async function run({ specl, base, addSteppers = [], logger, shared = {}, runtime = {}, featureFilter = '' }
    : { specl: TSpecl; base: string; addSteppers?: IStepperConstructor[]; logger: TLogger; shared?: TShared; runtime?: TRuntime; featureFilter?: string }): Promise<{ result: TResult; shared?: any }> {
  const features = await recurse(`${base}/features`, [/\.feature$/, featureFilter]);

  const backgrounds = existsSync(`${base}/backgrounds`) ? await recurse(`${base}/backgrounds`, [/\.feature$/]) : [];
  
  const steppers: IStepper[] = await getSteppers({ steppers: specl.steppers, shared, logger, addSteppers, runtime });
  if (specl.refs) {
    await parse(specl, base, steppers);
  }

  let expandedFeatures;
  try {
    expandedFeatures = await expand(backgrounds, features);
  } catch (error) {
    return { result: { ...notOk, failure: { stage: 'Expand', error: error.message } } };
  }
  
  let mappedValidatedSteps;
  try {
    const resolver = new Resolver(steppers, specl, logger);
    mappedValidatedSteps = await resolver.resolveSteps(expandedFeatures);
  } catch (error) {
    return { result: { ...notOk, failure: { stage: 'Resolve', error: { details: error.message, context: { steppers, mappedValidatedSteps } } } } };
  }
  
  const investigator = new Investigator(steppers, specl, logger);
  const result = await investigator.investigate(mappedValidatedSteps);
  return { result, shared };
}

async function expand(backgrounds: TFeatures, features: TFeatures) {
  const expandedBackgrounds = await expandBackgrounds(backgrounds);

  const expandedFeatures = await expandFeatures(features, expandedBackgrounds);
  return expandedFeatures;
}
