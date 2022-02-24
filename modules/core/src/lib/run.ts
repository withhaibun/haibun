import { existsSync } from 'fs';
import { TSpecl, AStepper, TResult, TWorld, TFeature, TNotOKActionResult, TExtraOptions, TResolvedFeature, TEndRunCallback } from './defs';
import { expand } from './features';
import { FeaturesExecutor } from '../phases/Executor';
import { Resolver } from '../phases/Resolver';
import Builder from '../phases/Builder';
import { getSteppers, applyExtraOptions, recurse, debase, getRunTag, verifyRequiredOptions, setWorldOptions } from './util';
import { applyDomainsOrError } from './domain';

type TRunOptions = { specl: TSpecl; world: TWorld; base: string; addSteppers?: typeof AStepper[]; featureFilter?: string[]; extraOptions?: TExtraOptions; endRunCallback?: TEndRunCallback }

export async function run({ specl, base, world, addSteppers = [], featureFilter, extraOptions = {}, endRunCallback }: TRunOptions): Promise<{ result: TResult; steppers?: AStepper[] }> {
  let features;
  let backgrounds: TFeature[] = [];
  try {
    features = debase(base, recurse(`${base}/features`, 'feature', featureFilter));

    if (existsSync(`${base}/backgrounds`)) {
      backgrounds = debase(base, recurse(`${base}/backgrounds`, 'feature'));
    }
  } catch (error: any) {
    return { result: { ok: false, tag: getRunTag(-1, -1, -1, -1, {}, false), failure: { stage: 'Collect', error: { message: error.message, details: { stack: error.stack } } } } };
  }

  return runWith({ specl, world, features, backgrounds, addSteppers, extraOptions, endRunCallback });
}

type TRunWithOptions = {
  specl: TSpecl;
  world: TWorld;
  features: TFeature[];
  backgrounds: TFeature[];
  addSteppers: typeof AStepper[];
  endRunCallback?: TEndRunCallback
  extraOptions?: TExtraOptions;
}

export const DEF_PROTO_OPTIONS = { options: {}, extraOptions: {} };

export async function runWith({ specl, world, features, backgrounds, addSteppers, extraOptions = {}, endRunCallback }: TRunWithOptions): Promise<{ result: TResult; steppers?: AStepper[] }> {
  const { tag } = world;

  let steppers: AStepper[] = [];
  let result;
  const errorBail = (phase: string, error: any, details?: any) => {
    result = { ok: false, tag, failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } } };
    throw Error(error)
  };
  try {
    steppers = await getSteppers({ steppers: specl.steppers, addSteppers }).catch(error => errorBail('Steppers', error));
    await applyExtraOptions(extraOptions, steppers, world).catch(error => errorBail('Options', error));
    await verifyRequiredOptions(steppers, world.options).catch(error => errorBail('Required Options', error));
    await setWorldOptions(steppers, world).catch(error => errorBail('Apply Options', error));
    await applyDomainsOrError(steppers, world).catch(error => (errorBail('Domains', error, { stack: error.stack })));

    const expandedFeatures = await expand(backgrounds, features).catch(error => errorBail('Expand', tag, error));

    const resolver = new Resolver(steppers, specl.mode, world);
    const mappedValidatedSteps: TResolvedFeature[] = await resolver.resolveSteps(expandedFeatures).catch(error => errorBail('Resolve', error));

    const builder = new Builder(world);
    await builder.build(mappedValidatedSteps).catch(error => errorBail('Build', error, { stack: error.stack, steppers, mappedValidatedSteps }))

    world.logger.log(`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map((e) => e.path)}), ${mappedValidatedSteps.length}`);

    const executor = new FeaturesExecutor(steppers, world);
    const executed = await executor.execute(mappedValidatedSteps);
    result = { ...executed, tag };

    if (endRunCallback) {
      try {
        await endRunCallback(world, result, steppers!)
      } catch (error) {
        errorBail('End Trace', error);
      }
    }
    if (!result.ok) {
      const message = (result.results![0].stepResults.find(s => !s.ok)?.actionResults[0] as TNotOKActionResult).message;
      result.failure = { stage: 'Execute', error: { message, details: { errors: result.results?.filter((r) => !r.ok).map((r) => r.path) } } };
    }
  } catch (error: any) {
    if (!result) {
      result = { ok: false, tag, failure: { ...error } };
    }
    return { result, steppers };
  }
  return { result, steppers };
}
