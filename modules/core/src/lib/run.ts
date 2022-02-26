import { existsSync } from 'fs';
import { TSpecl, TResult, TWorld, TFeature, TExtraOptions, TResolvedFeature, TEndRunCallback, CStepper } from './defs';
import { expand } from './features';
import { Executor } from '../phases/Executor';
import { Resolver } from '../phases/Resolver';
import Builder from '../phases/Builder';
import { getSteppers, verifyExtraOptions, recurse, debase, getRunTag, verifyRequiredOptions, createSteppers, setWorldStepperOptions } from './util';
import { getDomains, verifyDomainsOrError } from './domain';

type TRunOptions = { specl: TSpecl; world: TWorld; base: string; addSteppers?: CStepper[]; featureFilter?: string[]; extraOptions?: TExtraOptions; endRunCallback?: TEndRunCallback }

export async function run({ specl, base, world, addSteppers = [], featureFilter, endRunCallback }: TRunOptions): Promise<TResult> {
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

  return runWith({ specl, world, features, backgrounds, addSteppers, endRunCallback });
}

type TRunWithOptions = {
  specl: TSpecl;
  world: TWorld;
  features: TFeature[];
  backgrounds: TFeature[];
  addSteppers: CStepper[];
  endRunCallback?: TEndRunCallback
}

export const DEF_PROTO_OPTIONS = { options: {}, extraOptions: {} };

export async function runWith({ specl, world, features, backgrounds, addSteppers, endRunCallback }: TRunWithOptions): Promise<TResult> {
  const { tag } = world;

  let result = undefined;
  try {
    const errorBail = (phase: string, error: any, details?: any) => {
      result = { ok: false, tag, failure: { stage: phase, error: { message: error.message, details: { stack: error.stack, details } } } };
      throw Error(error)
    };
    const baseSteppers = await getSteppers(specl.steppers).catch(error => errorBail('Steppers', error));
    const csteppers = baseSteppers.concat(addSteppers);


    await verifyRequiredOptions(csteppers, world.options).catch(error => errorBail('Required Options', error));
    await verifyExtraOptions(world.extraOptions, csteppers).catch((error: any) => errorBail('Options', error));

    const expandedFeatures = await expand(backgrounds, features).catch(error => errorBail('Expand', tag, error));

    const steppers = await createSteppers(csteppers);
    await setWorldStepperOptions(steppers, world);

    world.domains = await getDomains(steppers, world).catch(error => errorBail('Get Domains', error));
    await verifyDomainsOrError(steppers, world).catch(error => errorBail('Required Domains', error));

    const resolver = new Resolver(steppers, specl.mode, world);
    const mappedValidatedSteps: TResolvedFeature[] = await resolver.resolveSteps(expandedFeatures).catch(error => errorBail('Resolve', error));

    const builder = new Builder(steppers, world);
    await builder.build(mappedValidatedSteps).catch(error => errorBail('Build', error, { stack: error.stack, mappedValidatedSteps }))

    world.logger.log(`features: ${expandedFeatures.length} backgrounds: ${backgrounds.length} steps: (${expandedFeatures.map((e) => e.path)}), ${mappedValidatedSteps.length}`);

    result = await Executor.execute(csteppers, world, mappedValidatedSteps, endRunCallback).catch(error => errorBail('Execute', error));

    // if (!result || !result.ok) {
    //   const message = (result.results![0].stepResults.find(s => !s.ok)?.actionResults[0] as TNotOKActionResult).message;
    //   result.failure = { stage: 'Execute', error: { message, details: { errors: result.results?.filter((r) => !r.ok).map((r) => r.path) } } };
    // }
  } catch (e) {
    console.log('fell', e);
  } finally {
    return result!;
  }
}
