import { TSpecl, TResult, TWorld, TFeature, TExtraOptions, TResolvedFeature, TEndFeatureCallback, CStepper, DEFAULT_DEST, TNotOKActionResult } from './defs.js';
import { expand } from './features.js';
import { Executor } from '../phases/Executor.js';
import { Resolver } from '../phases/Resolver.js';
import Builder from '../phases/Builder.js';
import { getSteppers, verifyExtraOptions, getRunTag, verifyRequiredOptions, createSteppers, setWorldStepperOptions } from './util/index.js';
import { getDomains, verifyDomainsOrError } from './domain.js';
import { getFeaturesAndBackgrounds } from '../phases/collector.js';

type TBaseOptions = { specl: TSpecl; world: TWorld; addSteppers?: CStepper[]; endFeatureCallback?: TEndFeatureCallback; };

type TRunOptions = TBaseOptions & { base: string, featureFilter: string[], extraOptions: TExtraOptions, };

type TRunWithFeaturesBackgrounds = TBaseOptions & { features: TFeature[]; backgrounds: TFeature[]; };

export const DEF_PROTO_DEFAULT_OPTIONS = { DEST: DEFAULT_DEST };
export const DEF_PROTO_OPTIONS = { options: DEF_PROTO_DEFAULT_OPTIONS, extraOptions: {} };

export async function run({ specl, base, world, addSteppers = [], featureFilter, endFeatureCallback }: TRunOptions): Promise<TResult> {
  if (!world.options || !world.extraOptions) {
    throw Error(`missing options ${world.options} extraOptions ${world.extraOptions}`);
  }
  let featuresBackgrounds;
  try {
    featuresBackgrounds = getFeaturesAndBackgrounds(base, featureFilter);
  } catch (error) {
    return ({ ok: false, tag: getRunTag(-1, -1, -1, -1, {}, false), failure: { stage: 'Collect', error: { message: error.message, details: { stack: error.stack } } }, shared: world.shared });
  }
  const { features, backgrounds } = featuresBackgrounds;
  return runWith({ specl, world, features, backgrounds, addSteppers, endFeatureCallback });
}

export async function runWith({ specl, world, features, backgrounds, addSteppers, endFeatureCallback }: TRunWithFeaturesBackgrounds): Promise<TResult> {
  const { tag } = world;

  let result = undefined;
  const errorBail = (phase: string, error: any, details?: any) => {
    result = { ok: false, tag, failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } } };
    console.log(error);

    throw Error(error);
  };
  try {
    const baseSteppers = await getSteppers(specl.steppers).catch((error) => errorBail('Steppers', error));
    const csteppers = baseSteppers.concat(addSteppers);

    await verifyRequiredOptions(csteppers, world.options).catch((error) => errorBail('Required Options', error));
    await verifyExtraOptions(world.extraOptions, csteppers).catch((error) => errorBail('Options', error));

    const expandedFeatures = await expand(backgrounds, features).catch((error) => errorBail('Expand', error));

    const steppers = await createSteppers(csteppers);
    await setWorldStepperOptions(steppers, world);

    world.domains = await getDomains(steppers, world).catch((error) => errorBail('Get Domains', error));
    await verifyDomainsOrError(steppers, world).catch((error) => errorBail('Required Domains', error));

    const resolver = new Resolver(steppers, specl.mode, world);
    const mappedValidatedSteps: TResolvedFeature[] = await resolver.resolveSteps(expandedFeatures).catch((error) => errorBail('Resolve', error));

    const builder = new Builder(steppers, world);
    await builder.build(mappedValidatedSteps).catch((error) => errorBail('Build', error, { stack: error.stack, mappedValidatedSteps }));

    world.logger.log(`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map((e) => e.path)}), ${mappedValidatedSteps.length}`);

    result = await Executor.execute(csteppers, world, mappedValidatedSteps, endFeatureCallback).catch((error) => errorBail('Execute', error));
    if (!result || !result.ok) {
      const message = (result.results[0].stepResults.find((s) => !s.ok)?.actionResults[0] as TNotOKActionResult).message;
      result.failure = { stage: 'Execute', error: { message, details: { errors: result.results?.filter((r) => !r.ok).map((r) => r.path) } } };
    }
  } catch (error) {
    if (!result) {
      errorBail('catch', error);
    }
  }
  return result;
}

function trying<TResult>(fun: () => void): Promise<Error | TResult> {
  return new Promise((resolve, reject) => {
    try {
      const res = <TResult>fun();
      return resolve(res);
    } catch (e: unknown) {
      // https://kentcdodds.com/blog/get-a-catch-block-error-message-with-typescript
      return reject(typeof e === 'object' && e !== null && 'message' in e && typeof (e as Record<string, unknown>).message === 'string');
    }
  });
}
