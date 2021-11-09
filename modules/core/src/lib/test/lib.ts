import { IExtensionConstructor, TWorld, TVStep, TProtoOptions, TExpandedLine, TOptions } from '../defs';
import { Resolver } from '../../phases/Resolver';
import { run, runWith } from './../run';
import { getOptionsOrDefault, getSteppers, getRunTag } from './../util';
import { WorldContext } from '../contexts';
import { featureSplit, withNameType } from './../features';
import { applyDomainsOrError } from './../domain';
import Logger, { LOGGER_NONE } from './../Logger';

export const HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = 'HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS';

export async function getTestEnv(useSteppers: string[], test: string, world: TWorld) {
  const steppers = await getSteppers({ steppers: useSteppers, world });
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

export async function testWithDefaults(these: { path: string, content: string }[], addSteppers: IExtensionConstructor[], options?: TOptions) {
  const specl = getOptionsOrDefault();

  const { world } = getDefaultWorld(0);
  if (options) {
    world.options = options;
  }
  const features = asFeatures(these);
  return { world, ...await runWith({ specl, features, backgrounds: [], addSteppers, world }) };
}

export async function testRun(baseIn: string, addSteppers: IExtensionConstructor[], world: TWorld, protoOptions?: TProtoOptions) {
  const base = process.cwd() + baseIn;
  const specl = getOptionsOrDefault(base);

  const res = await run({ specl, base, addSteppers, world, protoOptions });
  return res;
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
      tag: { sequence: 0, loop: 0, member: 0 },
      shared: new WorldContext(getDefaultTag(sequence)),
      logger: new Logger(process.env.HAIBUN_LOG_LEVEL ? { level: process.env.HAIBUN_LOG_LEVEL } : LOGGER_NONE),
      runtime: {},
      options: {},
      domains: [],
    },
  };
}

export function getDefaultTag(sequence: number, desc: string | undefined = undefined) {
  return getRunTag(sequence, 0, 0, desc ? { desc } : undefined, false);
}