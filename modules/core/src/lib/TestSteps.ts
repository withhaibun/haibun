import { IStepper, IExtensionConstructor, IHasOptions, TWorld } from './defs';
import { actionNotOK, actionOK, getStepperOption } from './util';

export const TestSteps: IExtensionConstructor = class TestSteps implements IStepper {
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
      action: async ({ param }: { param: string }) => {
        return param === 'x' ? actionOK() : actionNotOK('test');
      },
    },
    throws: {
      gwta: 'throw an exception',
      action: async () => {
        throw Error(`<Thrown for test case>`);
      },
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
      parse: (input: string) => 42
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
