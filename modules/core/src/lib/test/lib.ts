import { TWorld, TVStep, TExpandedLine, AStepper, TProtoOptions } from '../defs';
import { Resolver } from '../../phases/Resolver';
import { DEF_PROTO_OPTIONS, runWith } from './../run';
import { getSteppers, getRunTag, applyExtraOptions, getDefaultOptions } from './../util';
import { WorldContext } from '../contexts';
import { featureSplit, withNameType } from './../features';
import { applyDomainsOrError } from './../domain';
import Logger, { LOGGER_NONE } from './../Logger';
import { Timer } from '../Timer';

export const HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = 'HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS';

export async function getTestEnv(useSteppers: string[], test: string, world: TWorld) {
  const steppers = await getSteppers({ steppers: useSteppers });
  applyExtraOptions({}, steppers, world);
  applyDomainsOrError(steppers, world);

  const resolver = new Resolver(steppers, 'all', world);
  const actions = resolver.findSteps(test);

  const vstep: TVStep = {
    source: { ...withNameType('test', '') },
    in: test,
    seq: 0,
    actions,
  };
  return { world, vstep, steppers };
}
type TTestFeatures = { path: string, content: string }[];
export async function testWithDefaults(inFeatures: TTestFeatures, addSteppers: typeof AStepper[], protoOptions: TProtoOptions = DEF_PROTO_OPTIONS, inBackgrounds: TTestFeatures = []) {
  const specl = getDefaultOptions();
  const { options, extraOptions } = protoOptions;

  const { world } = getDefaultWorld(0);
  if (protoOptions) {
    world.options = options;
  }

  const features = asFeatures(inFeatures);
  const backgrounds = asFeatures(inBackgrounds);

  return { world, ...await runWith({ specl, features, backgrounds, addSteppers, world, extraOptions }) };
}

export const asFeatures = (w: { path: string; content: string }[]) => w.map((i) => withNameType(i.path, i.content));

// FIXME can't really do this without reproducing resolve
export const asExpandedFeatures = (w: { path: string; content: string }[]) =>
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
      tag: { sequence, loop: 0, member: 0, featureNum: -1 },
      shared: new WorldContext(getDefaultTag(sequence)),
      logger: new Logger(process.env.HAIBUN_LOG_LEVEL ? { level: process.env.HAIBUN_LOG_LEVEL } : LOGGER_NONE),
      runtime: {},
      options: {},
      domains: [],
    },
  };
}

export function getDefaultTag(sequence: number, desc: string | undefined = undefined) {
  return getRunTag(sequence, 0, 0, -1, desc ? { desc } : undefined, false);
}