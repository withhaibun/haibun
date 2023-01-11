import { IHasOptions, AStepper } from '../defs';
import { actionOK, getStepperOption } from '../util/index.js';

const TestStepsWithOptions = class TestStepsWithOptions extends AStepper implements IHasOptions {
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
        const res = getStepperOption(this, 'EXISTS', this.getWorld().extraOptions);
        return actionOK({ options: { summary: 'options', details: res } });
      },
    },
  };
};

export default TestStepsWithOptions;