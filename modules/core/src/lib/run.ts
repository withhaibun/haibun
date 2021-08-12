import { existsSync } from 'fs';
import { TSpecl, IStepper, IExtensionConstructor, TResult, TFeatures, TWorld, TProtoOptions, TFeature, IHasDomains, TFileTypeDomain } from './defs';
import { expandBackgrounds, expandFeatures, findFeatures, findFeaturesOfType } from './features';
import { Executor } from '../phases/Executor';
import { Resolver } from '../phases/Resolver';
import { getSteppers, applyExtraOptions, recurse } from './util';

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
  const features = await recurse(`${base}/features`, 'feature', featureFilter);
  let backgrounds: TFeature[] = [];

  const steppers: IStepper[] = await getSteppers({ steppers: specl.steppers, addSteppers, world });
  try {
    applyExtraOptions(protoOptions, steppers, world);
  } catch (error: any) {
    console.error(error);
    return { result: { ok: false, failure: { stage: 'Options', error: { details: error.message, context: error } } } };
  }

  if (existsSync(`${base}/backgrounds`)) {
    backgrounds = await recurse(`${base}/backgrounds`, '');
    for (const s of steppers.filter((s) => !!(<IHasDomains>s).domains)) {
      const module = s.constructor.name;
      const domains = (<IHasDomains>s).domains;
      if (domains) {
        for (const d of domains) {
          if (world.domains.find((w) => w.name === d.name)) {
            return { result: { ok: false, failure: { stage: 'Options', error: { details: `duplicate domain at ${module}`, context: world.domains } } } };
          }
          const ftBackgrounds = (d as TFileTypeDomain).fileType ? findFeaturesOfType(backgrounds, (d as TFileTypeDomain).fileType) : [];
          world.domains.push({ ...d, module, backgrounds: ftBackgrounds });
        }
      }
    }
  }

  let expandedFeatures;
  try {
    expandedFeatures = await expand(backgrounds, features);
  } catch (error: any) {
    return { result: { ok: false, failure: { stage: 'Expand', error: { details: error.message, context: error } } } };
  }

  let mappedValidatedSteps;
  try {
    const resolver = new Resolver(steppers, specl.mode, world);
    mappedValidatedSteps = await resolver.resolveSteps(expandedFeatures);
  } catch (error: any) {
    return { result: { ok: false, failure: { stage: 'Resolve', error: { details: error.message, context: { stack: error.stack, steppers, mappedValidatedSteps } } } } };
  }
  world.logger.log(`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map((e) => e.path)}), ${mappedValidatedSteps.length}`);

  const executor = new Executor(steppers, world);
  const result = await executor.execute(mappedValidatedSteps);
  if (!result.ok) {
    result.failure = { stage: 'Execute', error: { context: result.results?.filter((r) => !r.ok).map((r) => r.path) } };
  }
  return { result, steppers };
}

async function expand(backgrounds: TFeatures, features: TFeatures): Promise<TFeature[]> {
  const expandedBackgrounds = await expandBackgrounds(backgrounds);

  const expandedFeatures = await expandFeatures(features, expandedBackgrounds);
  return expandedFeatures;
}
