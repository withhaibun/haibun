import { withAction } from './withAction.js';
import { AStepper } from '../lib/astepper.js';
import { OK } from '../lib/defs.js';

class TestStepper extends AStepper {
  steps = {
    set: {
      gwta: 'set {what} to {value}',
      action: async () => OK,
    },
  };
}

const stepper = new TestStepper();
const { set } = withAction(stepper);

export const features = {
  'test feature': [
    set({ what: 'test', value: 'value' }),
  ],
};
