import { IHasOptions, AStepper } from '../defs.js';
import { actionOK, getStepperOption } from '../util/index.js';

export const TestStepsWithOptions = class TestStepsWithOptions extends AStepper implements IHasOptions {
  options = {
    EXISTS: {
      desc: 'option exists',
      parse: (input: string) => ({ result: 42 }),
    },
  };
  steps = {
    test: {
      exact: 'have a stepper option',
      action: async () => {
        const res = getStepperOption(this, 'EXISTS', this.getWorld().extraOptions);
        return actionOK({ options: { summary: 'options', details: res } });
      },
    },
  };
};

export default TestStepsWithOptions;

export const TestStepsWithRequiredOptions = class TestStepsWithRequiredOptions extends AStepper implements IHasOptions {
  options = {
    EXISTS: {
      required: true,
      desc: 'option exists',
      parse: (input: string) => ({ result: 42 }),
    },
  };
  steps = {
    test: {
      exact: 'have a stepper option',
      action: async () => {
        const res = getStepperOption(this, 'EXISTS', this.getWorld().extraOptions);
        return actionOK({ options: { summary: 'options', details: res } });
      },
    },
  };
};
