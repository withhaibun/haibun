import { existsSync } from 'fs';
import { TSpecl, IStepper, IExtensionConstructor, TResult, TWorld, TProtoOptions, TFeature } from './defs';
import { expand } from './features';
import { Executor } from '../phases/Executor';
import { Resolver } from '../phases/Resolver';
import Builder from '../phases/Builder';
import { getSteppers, applyExtraOptions, recurse, debase } from './util';
import { applyDomainsOrError } from './domain';

export async function run({
  specl,
  base,
  world,
  addSteppers = [],
  featureFilter = '',
  protoOptions: protoOptions = { options: {}, extraOptions: {} },
}: {
  specl: TSpecl;
  world: TWorld;
  base: string;
  addSteppers?: IExtensionConstructor[];
  featureFilter?: string;
  protoOptions?: TProtoOptions;
}): Promise<{ result: TResult; steppers?: IStepper[] }> {
  const features = debase(base, recurse(`${base}/features`, 'feature', featureFilter));
  let backgrounds: TFeature[] = [];

  if (existsSync(`${base}/backgrounds`)) {
    backgrounds = debase(base, recurse(`${base}/backgrounds`, ''));
  }

  return runWith({ specl, world, features, backgrounds, addSteppers, protoOptions });
}

export async function runWith({
  specl,
  world,
  features,
  backgrounds,
  addSteppers,
  protoOptions: protoOptions = { options: {}, extraOptions: {} },
}: {
  specl: TSpecl;
  world: TWorld;
  features: TFeature[];
  backgrounds: TFeature[];
  addSteppers: IExtensionConstructor[];
  protoOptions?: TProtoOptions;
}): Promise<{ result: TResult; steppers?: IStepper[] }> {
  const steppers: IStepper[] = await getSteppers({ steppers: specl.steppers, addSteppers, world });
  try {
    applyExtraOptions(protoOptions, steppers, world);
  } catch (error: any) {
    console.log('e', error);
    
    return { result: { ok: false, failure: { stage: 'Options', error: { message: error.message, details: error } } } };
  }

  try {
    applyDomainsOrError(steppers, world);
  } catch (error: any) {
    return { result: { ok: false, failure: { stage: 'Domains', error: { message: error.message, details: { stack: error.stack } } } } };
  }

  let expandedFeatures;
  try {
    expandedFeatures = await expand(backgrounds, features);
  } catch (error: any) {
    return { result: { ok: false, failure: { stage: 'Expand', error: { message: error.message, details: error } } } };
  }

  let mappedValidatedSteps;
  try {
    const resolver = new Resolver(steppers, specl.mode, world);
    mappedValidatedSteps = await resolver.resolveSteps(expandedFeatures);
  } catch (error: any) {
    return { result: { ok: false, failure: { stage: 'Resolve', error: { message: error.message, details: { stack: error.stack, steppers, mappedValidatedSteps } } } } };
  }

  const builder = new Builder(world);
  try {
    const res = await builder.build(mappedValidatedSteps);
    world.logger.log(`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map((e) => e.path)}), ${mappedValidatedSteps.length}`);
  } catch (error: any) {
    console.error(error);
    return { result: { ok: false, failure: { stage: 'Build', error: { message: error.message, details: { stack: error.stack, steppers, mappedValidatedSteps } } } } };
  }

  const executor = new Executor(steppers, world);
  const result = await executor.execute(mappedValidatedSteps);
  if (!result.ok) {
    result.failure = { stage: 'Execute', error: { message: '!!FIXME', details: { errors: result.results?.filter((r) => !r.ok).map((r) => r.path) } } };
  }
  return { result, steppers };
}
