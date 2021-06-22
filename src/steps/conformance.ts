import { actionNotOK } from 'src/lib/util';
import { IStepper, IStepperConstructor } from '../lib/defs';

const Conformance: IStepperConstructor = class Conformance implements IStepper {
  steps = {
    must: {
      match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
      action: async (input: any) => actionNotOK('not implemented'),
    },
  };
};

export default Conformance;
