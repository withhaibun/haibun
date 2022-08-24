import { TWorld, TVStep, TExpandedLine, TProtoOptions, CStepper, TExpandedFeature, DEFAULT_DEST } from '../defs';
import { Resolver } from '../../phases/Resolver';
import { DEF_PROTO_OPTIONS, runWith } from './../run';
import { getSteppers, getRunTag, verifyExtraOptions, getDefaultOptions, createSteppers } from './../util';
import { WorldContext } from '../contexts';
import { featureSplit, withNameType } from './../features';
import { getDomains, verifyDomainsOrError } from './../domain';
import Logger, { LOGGER_NONE } from './../Logger';
import { Timer } from '../Timer';

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

export async function testWithDefaults(featuresIn: TTestFeatures | string, addSteppers: CStepper[], protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, inBackgrounds: TTestFeatures = []) {
  const inFeatures = (typeof featuresIn == 'string') ? [{ path: '/features/test', content: featuresIn }] : featuresIn;
  const specl = getDefaultOptions();
  const world = getTestWorldWithOptions(protoOptions);
  
  const features = asFeatures(inFeatures);
  const backgrounds = asFeatures(inBackgrounds);

  return await runWith({ specl, features, backgrounds, addSteppers, world });
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
      logger: new Logger(process.env.HAIBUN_LOG_LEVEL ? { level: process.env.HAIBUN_LOG_LEVEL } : LOGGER_NONE),
      runtime: {},
      options: { DEST: DEFAULT_DEST },
      extraOptions: {},
      domains: [],
      base: process.cwd()
    },
  };
}

export function getDefaultTag(sequence: number, desc: string | undefined = undefined) {
  return getRunTag(sequence, 0, 0, -1, desc ? { desc } : undefined, false);
}