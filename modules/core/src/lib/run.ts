import { existsSync } from 'fs';
import { TSpecl, TResult, TWorld, TFeature, TExtraOptions, TResolvedFeature, TEndFeatureCallback, CStepper, DEFAULT_DEST, TNotOKActionResult } from './defs';
import { expand } from './features';
import { Executor } from '../phases/Executor';
import { Resolver } from '../phases/Resolver';
import Builder from '../phases/Builder';
import { getSteppers, verifyExtraOptions, recurse, debase, getRunTag, verifyRequiredOptions, createSteppers, setWorldStepperOptions } from './util';
import { getDomains, verifyDomainsOrError } from './domain';

type TRunOptions = { specl: TSpecl; world: TWorld; base: string; addSteppers?: CStepper[]; featureFilter?: string[]; extraOptions?: TExtraOptions; endFeatureCallback?: TEndFeatureCallback }

export async function run({ specl, base, world, addSteppers = [], featureFilter, endFeatureCallback }: TRunOptions): Promise<TResult> {
  let features;
  let backgrounds: TFeature[] = [];
  try {
    features = debase(base, recurse(`${base}/features`, 'feature', featureFilter));

    if (existsSync(`${base}/backgrounds`)) {
      backgrounds = debase(base, recurse(`${base}/backgrounds`, 'feature'));
    }
  } catch (error: any) {
    return { ok: false, tag: getRunTag(-1, -1, -1, -1, {}, false), failure: { stage: 'Collect', error: { message: error.message, details: { stack: error.stack } } }, shared: world.shared };
  }

  return runWith({ specl, world, features, backgrounds, addSteppers, endFeatureCallback });
}

type TRunWithOptions = {
  specl: TSpecl;
  world: TWorld;
  features: TFeature[];
  backgrounds: TFeature[];
  addSteppers: CStepper[];
  endFeatureCallback?: TEndFeatureCallback
}

export const DEF_PROTO_DEFAULT_OPTIONS = { DEST: DEFAULT_DEST };
export const DEF_PROTO_OPTIONS = { options: DEF_PROTO_DEFAULT_OPTIONS, extraOptions: {} };

export async function runWith({ specl, world, features, backgrounds, addSteppers, endFeatureCallback }: TRunWithOptions): Promise<TResult> {
  
  const { tag } = world;

  let result = undefined;
  const errorBail = (phase: string, error: any, details?: any) => {
    result = { ok: false, tag, failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } } };
    console.log(error);
    
    throw Error(error)
  };
  try {
    const baseSteppers = await getSteppers(specl.steppers).catch(error => errorBail('Steppers', error));
    const csteppers = baseSteppers.concat(addSteppers);

    await verifyRequiredOptions(csteppers, world.options).catch(error => errorBail('Required Options', error));
    await verifyExtraOptions(world.extraOptions, csteppers).catch((error: any) => errorBail('Options', error));

    const expandedFeatures = await expand(backgrounds, features).catch(error => errorBail('Expand', error));

    const steppers = await createSteppers(csteppers);
    await setWorldStepperOptions(steppers, world);

    world.domains = await getDomains(steppers, world).catch(error => errorBail('Get Domains', error));
    await verifyDomainsOrError(steppers, world).catch(error => errorBail('Required Domains', error));

    const resolver = new Resolver(steppers, specl.mode, world);
    const mappedValidatedSteps: TResolvedFeature[] = await resolver.resolveSteps(expandedFeatures).catch(error => errorBail('Resolve', error));

    const builder = new Builder(steppers, world);
    await builder.build(mappedValidatedSteps).catch(error => errorBail('Build', error, { stack: error.stack, mappedValidatedSteps }))
    
    world.logger.log(`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map((e) => e.path)}), ${mappedValidatedSteps.length}`);

    result = await Executor.execute(csteppers, world, mappedValidatedSteps, endFeatureCallback).catch(error => errorBail('Execute', error));
    if (!result || !result.ok) {
      const message = (result.results![0].stepResults.find(s => !s.ok)?.actionResults[0] as TNotOKActionResult).message;
      result.failure = { stage: 'Execute', error: { message, details: { errors: result.results?.filter((r) => !r.ok).map((r) => r.path) } } };
    }
  } catch (error) {
    if (!result) {
      errorBail('catch', error);
    }
  } finally {
    return result!;
  }
}
