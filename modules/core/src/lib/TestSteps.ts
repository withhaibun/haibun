import { IStepper, IExtensionConstructor, IHasOptions, TWorld, TVStep, TProtoOptions, TNamed, IHasDomains, TExpandedLine, TOptions } from './defs';
import { Resolver } from '../phases/Resolver';
import { run, runWith } from './run';
import { actionNotOK, actionOK, getOptionsOrDefault, getStepperOption, getSteppers, getRunTag } from './util';
import { WorkspaceContext, WorldContext } from './contexts';
import { featureSplit, withNameType } from './features';
import { applyDomainsOrError } from './domain';
import Logger, { LOGGER_NONE } from './Logger';

export const TestSteps: IExtensionConstructor = class TestSteps implements IStepper {
  world: TWorld;
  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    test: {
      exact: 'When I have a test',
      action: async (input: any) => actionOK(),
    },
    passes: {
      exact: 'Then the test should pass',
      action: async (input: any) => actionOK(),
    },
    fails: {
      exact: 'Then the test can fail',
      action: async (input: any) => actionNotOK('test'),
    },
    named: {
      match: /^Then the parameter (?<param>.+) is accepted$/,
      action: async ({ param }: TNamed) => {
        return param === 'x' ? actionOK() : actionNotOK('test');
      },
    },
    throws: {
      gwta: 'throw an exception',
      action: async () => {
        throw Error(`<Thrown for test case>`);
      },
    },
    buildsWithFinalizer: {
      gwta: 'builds with finalizer',
      action: async () => actionOK(),
      build: async () => {
        return {
          ...actionOK(),
          finalize: (workspace: WorkspaceContext) => {
            this.world.shared.set('done', 'ok');
          },
        };
      },
    },
  };
};

export const TestStepsWithDomain: IExtensionConstructor = class TestStepsWithDomain implements IStepper, IHasDomains {
  world: TWorld;
  domains = [{ name: 'door', fileType: 'door', is: 'string', validate: () => undefined }];
  locator = (name: string) => name;
  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    test: {
      exact: 'The door is open',
      action: async (input: any) => actionOK(),
    },
  };
};

export const HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS = 'HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS';

export const TestStepsWithOptions: IExtensionConstructor = class TestStepsWithOptions implements IStepper, IHasOptions {
  world: TWorld;
  constructor(world: TWorld) {
    this.world = world;
  }
  options = {
    EXISTS: {
      desc: 'option exists',
      parse: (input: string) => 42,
    },
  };
  steps = {
    test: {
      exact: 'When I have a stepper option',
      action: async () => {
        const res = getStepperOption(this, 'EXISTS', this.world.options);
        return actionOK({ options: { summary: 'options', details: res } });
      },
    },
  };
};

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
  return getRunTag(sequence, 0, 0, desc ? { desc } : undefined);
}