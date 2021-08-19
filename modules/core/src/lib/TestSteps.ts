import { IStepper, IExtensionConstructor, IHasOptions, TWorld, TVStep, TProtoOptions, TNamed, IHasDomains } from './defs';
import { Resolver } from '../phases/Resolver';
import { run } from './run';
import { actionNotOK, actionOK, getOptionsOrDefault, getStepperOption, getSteppers, withNameType } from './util';
import { WorkspaceContext } from './contexts';
import { featureSplit } from './features';

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
        return actionOK(`${res}`);
      },
    },
  };
};

export async function getTestEnv(useSteppers: string[], test: string, world: TWorld) {
  const steppers = await getSteppers({ steppers: useSteppers, world });
  const resolver = new Resolver(steppers, 'all', world);
  const actions = resolver.findSteps(test);

  const vstep: TVStep = {
    feature: {...withNameType('test', ''), expanded: []},
    in: test,
    seq: 0,
    actions,
  };
  return { world, vstep, steppers };
}

export async function testRun(baseIn: string, addSteppers: IExtensionConstructor[], world: TWorld, protoOptions?: TProtoOptions) {
  const base = process.cwd() + baseIn;
  const specl = getOptionsOrDefault(base);

  const res = await run({ specl, base, addSteppers, world, protoOptions });
  return res;
}

export const asFeatures = (w: { path: string; content: string }[]) => w.map((i) => withNameType(i.path, i.content));
export const asExpandedFeatures = (w: { path: string; content: string }[]) => w.map((i) => withNameType(i.path, i.content)).map((i) => {
  let a : any= { ...i, expanded: featureSplit(i.content) };
  delete a.content;
  return a;
});
