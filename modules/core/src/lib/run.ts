import { existsSync } from 'fs';
import { TSpecl, AStepper, TResult, TWorld, TFeature, TNotOKActionResult, TExtraOptions } from './defs';
import { expand } from './features';
import { Executor } from '../phases/Executor';
import { Resolver } from '../phases/Resolver';
import Builder from '../phases/Builder';
import { getSteppers, applyExtraOptions, recurse, debase, getRunTag } from './util';
import { applyDomainsOrError } from './domain';

type TrunOptions = { specl: TSpecl; world: TWorld; base: string; addSteppers?: typeof AStepper[]; featureFilter?: string[]; extraOptions?: TExtraOptions; }

export async function run({ specl, base, world, addSteppers = [], featureFilter, extraOptions = {} }: TrunOptions): Promise<{ result: TResult; steppers?: AStepper[] }> {
  let features;
  let backgrounds: TFeature[] = [];
  try {
    features = debase(base, recurse(`${base}/features`, 'feature', featureFilter));

    if (existsSync(`${base}/backgrounds`)) {
      backgrounds = debase(base, recurse(`${base}/backgrounds`, 'feature'));
    }
  } catch (error: any) {
    return { result: { ok: false, tag: getRunTag(-1, -1, -1, {}, false), failure: { stage: 'Collect', error: { message: error.message, details: { stack: error.stack } } } } };
  }

  return runWith({ specl, world, features, backgrounds, addSteppers, extraOptions });
}

type TRunWithOptions = {
  specl: TSpecl;
  world: TWorld;
  features: TFeature[];
  backgrounds: TFeature[];
  addSteppers: typeof AStepper[];
  extraOptions?: TExtraOptions;
}

export const DEF_PROTO_OPTIONS = { options: {}, extraOptions: {} };

export async function runWith({ specl, world, features, backgrounds, addSteppers, extraOptions = {} }: TRunWithOptions): Promise<{ result: TResult; steppers?: AStepper[] }> {
  const { tag } = world;

  const steppers: AStepper[] = await getSteppers({ steppers: specl.steppers, addSteppers });

  try {
    applyExtraOptions(extraOptions, steppers, world);
  } catch (error: any) {
    console.error(error);
    return { result: { ok: false, tag, failure: { stage: 'Options', error: { message: error.message, details: error } } } };
  }
  try {
    applyDomainsOrError(steppers, world);
  } catch (error: any) {
    return { result: { ok: false, tag, failure: { stage: 'Domains', error: { message: error.message, details: { stack: error.stack } } } } };
  }

  let expandedFeatures;
  try {
    expandedFeatures = await expand(backgrounds, features);
  } catch (error: any) {

    return { result: { ok: false, tag, failure: { stage: 'Expand', error: { message: error.message, details: error } } } };
  }

  let mappedValidatedSteps;
  try {
    const resolver = new Resolver(steppers, specl.mode, world);
    mappedValidatedSteps = await resolver.resolveSteps(expandedFeatures);
  } catch (error: any) {
    return { result: { ok: false, tag, failure: { stage: 'Resolve', error: { message: error.message, details: { stack: error.stack, steppers, mappedValidatedSteps } } } } };
  }

  const builder = new Builder(world);
  try {
    const res = await builder.build(mappedValidatedSteps);
    world.logger.log(`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map((e) => e.path)}), ${mappedValidatedSteps.length}`);
  } catch (error: any) {
    console.error(error);
    return { result: { ok: false, tag, failure: { stage: 'Build', error: { message: error.message, details: { stack: error.stack, steppers, mappedValidatedSteps } } } } };
  }

  const executor = new Executor(steppers, world);
  let result;
  try {
    result = { ...await executor.execute(mappedValidatedSteps), tag };

    if (!result.ok) {
      const message = (result.results![0].stepResults.find(s => !s.ok)?.actionResults[0] as TNotOKActionResult).message;

      result.failure = { stage: 'Execute', error: { message, details: { errors: result.results?.filter((r) => !r.ok).map((r) => r.path) } } };
    }
  } catch (e: any) {
    console.error('XXXXXXX', e);

    result = { ok: false, tag, failure: e };
  }
  return { result, steppers };
}
