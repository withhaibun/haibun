import { TWorld, TVStep, TExpandedLine, TProtoOptions, CStepper, TExpandedFeature, DEFAULT_DEST, TResult } from '../defs.js';
import { Resolver } from '../../phases/Resolver.js';
import { DEF_PROTO_OPTIONS, runWith } from './../run.js';
import { getSteppers, getRunTag, verifyExtraOptions, getDefaultOptions, createSteppers } from './../util/index.js';
import { WorldContext } from '../contexts.js'
import { featureSplit, withNameType } from './../features.js';
import { getDomains, verifyDomainsOrError } from './../domain.js';
import Logger, { LOGGER_NOTHING } from '../Logger.js';
import { Timer } from '../Timer.js';

export const HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = 'HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS';

export async function getCreateSteppers(steppers: string[], addSteppers?: CStepper[]) {
  const csteppers = await getSteppers(steppers);
  return await createSteppers(csteppers.concat(addSteppers || []));
}

export async function getTestEnv(useSteppers: string[], test: string, world: TWorld) {
  const csteppers = await getSteppers(useSteppers);
  const steppers = await createSteppers(csteppers);
  verifyExtraOptions({}, csteppers);
  world.domains = await getDomains(steppers, world);
  verifyDomainsOrError(steppers, world);

  const resolver = new Resolver(steppers, 'all', world);
  const actions = resolver.findSteps(test);

  const vstep: TVStep = {
    source: { ...withNameType('test', '') },
    in: test,
    seq: 0,
    actions,
  };
  return { world, vstep, csteppers, steppers };
}
type TTestFeatures = { path: string, content: string }[];

export async function testWithDefaults(featuresIn: TTestFeatures | string, addSteppers: CStepper[], protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, inBackgrounds: TTestFeatures = []): Promise<TResult & { world: TWorld }> {
  const inFeatures = (typeof featuresIn == 'string') ? [{ path: '/features/test', content: featuresIn }] : featuresIn;
  const specl = getDefaultOptions();
  const world = getTestWorldWithOptions(protoOptions);

  const features = asFeatures(inFeatures);
  const backgrounds = asFeatures(inBackgrounds);

  const ran = await runWith({ specl, features, backgrounds, addSteppers, world });
  return { ...ran, world };
}

export function getTestWorldWithOptions(protoOptions: TProtoOptions) {
  const { world } = getDefaultWorld(0);
  if (protoOptions) {
    world.options = protoOptions.options;
    world.extraOptions = protoOptions.extraOptions;
  }
  return world;
}


export const asFeatures = (w: { path: string; content: string }[]) => w.map((i) => withNameType(i.path, i.content));

// FIXME can't really do this without reproducing resolve
export const asExpandedFeatures = (w: { path: string; content: string }[]): TExpandedFeature[] =>
  asFeatures(w).map((i) => {
    const expanded: TExpandedLine[] = featureSplit(i.content).map((a) => ({ line: a, feature: i }));
    let a: any = { ...i, expanded };
    delete a.content;
    // a.featureLine = asFeatureLine()
    return a;
  });

export function getDefaultWorld(sequence: number): { world: TWorld; } {
  return {
    world: {
      timer: new Timer(),
      tag: getRunTag(sequence, 0, 0, 0),
      shared: new WorldContext(getDefaultTag(sequence)),
      logger: new Logger(process.env.HAIBUN_LOG_LEVEL ? { level: process.env.HAIBUN_LOG_LEVEL } : LOGGER_NOTHING),
      runtime: {},
      options: { DEST: DEFAULT_DEST },
      extraOptions: {},
      domains: [],
      base: '/features/'
    },
  };
}

export function getDefaultTag(sequence: number, desc: string | undefined = undefined) {
  return getRunTag(sequence, 0, 0, -1, desc ? { desc } : undefined, false);
}