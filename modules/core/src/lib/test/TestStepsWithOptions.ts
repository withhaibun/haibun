import { IStepper, IExtensionConstructor, IHasOptions, TWorld } from '../defs';
import { actionOK, getStepperOption } from '../util';


const TestStepsWithOptions: IExtensionConstructor = class TestStepsWithOptions implements IStepper, IHasOptions {
  world: TWorld;
  constructor(world: TWorld) {
    this.world = world;
  }
  options = {
    EXISTS: {
      desc: 'option exists',
      parse: (input: string) => ({ result: 42 }),
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

export default TestStepsWithOptions;