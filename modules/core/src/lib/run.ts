import { TSpecl, TExecutorResult, TWorld, TFeature, TResolvedFeature, TEndFeatureCallback, CStepper, DEFAULT_DEST, TNotOKActionResult, TBase } from './defs.js';
import { expand } from './features.js';
import { Executor } from '../phases/Executor.js';
import { Resolver } from '../phases/Resolver.js';
import Builder from '../phases/Builder.js';
import { getSteppers, verifyExtraOptions, getRunTag, verifyRequiredOptions, createSteppers, setStepperWorlds } from './util/index.js';
import { getDomains, verifyDomainsOrError } from './domain.js';
import { getFeaturesAndBackgrounds } from '../phases/collector.js';

type TBaseOptions = { specl: TSpecl; world: TWorld; addSteppers?: CStepper[]; endFeatureCallback?: TEndFeatureCallback; };

type TRunOptions = TBaseOptions & { bases: TBase, featureFilter: string[], };

type TRunWithFeaturesBackgrounds = TBaseOptions & { features: TFeature[]; backgrounds: TFeature[]; };

export const DEF_PROTO_DEFAULT_OPTIONS = { DEST: DEFAULT_DEST };
export const DEF_PROTO_OPTIONS = { options: DEF_PROTO_DEFAULT_OPTIONS, extraOptions: {} };

export async function run({ specl, bases, world, addSteppers = [], featureFilter, endFeatureCallback }: TRunOptions): Promise<TExecutorResult> {
  if (!world.options || !world.extraOptions) {
    throw Error(`missing options ${world.options} extraOptions ${world.extraOptions}`);
  }
  let featuresBackgrounds;
  try {
    featuresBackgrounds = getFeaturesAndBackgrounds(bases, featureFilter);
  } catch (error) {
    return ({ ok: false, tag: getRunTag(-1, -1, -1, -1, {}, false), failure: { stage: 'Collect', error: { message: error.message, details: { stack: error.stack } } }, shared: world.shared });
  }
  const { features, backgrounds } = featuresBackgrounds;

  const res = await runWith({ specl, world, features, backgrounds, addSteppers, endFeatureCallback });
  return res;
}

export async function runWith({ specl, world, features, backgrounds, addSteppers, endFeatureCallback }: TRunWithFeaturesBackgrounds): Promise<TExecutorResult> {
  const { tag } = world;

  let result: TExecutorResult = undefined;
  const errorBail = (phase: string, error: any, details?: any) => {
    result = { ok: false, shared: world.shared, tag, failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } } };
    throw Error(error);
  };

  try {
    const baseSteppers = await getSteppers(specl.steppers).catch((error) => errorBail('Steppers', error));
    const csteppers = baseSteppers.concat(addSteppers);

    await verifyRequiredOptions(csteppers, world.extraOptions).catch((error) => errorBail('RequiredOptions', error));
    await verifyExtraOptions(world.extraOptions, csteppers).catch((error) => errorBail('ExtraOptions', error));

    const expandedFeatures = await expand(backgrounds, features).catch((error) => errorBail('Expand', error));

    const steppers = await createSteppers(csteppers);

    await setStepperWorlds(steppers, world).catch((error) => errorBail('StepperOptions', error));

    world.domains = await getDomains(steppers).catch((error) => errorBail('GetDomains', error));
    await verifyDomainsOrError(steppers, world).catch((error) => errorBail('RequiredDomains', error));

    const builder = new Builder(steppers, world);
    const resolver = new Resolver(steppers, world, builder);
    const mappedValidatedSteps: TResolvedFeature[] = await resolver.resolveStepsFromFeatures(expandedFeatures).catch((error) => errorBail('Resolve', error));

    // await builder.build(mappedValidatedSteps).catch((error) => errorBail('Build', error, { stack: error.stack, mappedValidatedSteps }));
    await builder.finalize();

    world.logger.log(`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map((e) => e.path)}), ${mappedValidatedSteps.length}`);

    result = await Executor.execute(csteppers, world, mappedValidatedSteps, endFeatureCallback)
      .catch((error) => errorBail('Execute', error));
    if (!result || !result.ok) {
      let message;
      try {
        message = (result.featureResults[0].stepResults.find((s) => !s.ok)?.actionResults[0] as TNotOKActionResult)?.message || result.featureResults;
      } catch (e) {
        message = e;
      }
      result.failure = { stage: 'Execute', error: { message, details: { stack: [], errors: result.featureResults?.filter((r) => !r.ok).map((r) => r.path) } } };
    }
  } catch (error) {
    if (!result) {
      errorBail('catch', error);
    }
  }
  return result;
}

