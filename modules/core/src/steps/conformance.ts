import { actionNotOK } from '../lib/util';
import { AStepper } from '../lib/defs';

const Conformance = class Conformance extends AStepper {
  steps = {
    must: {
      match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
      action: async (input: any) => actionNotOK('not implemented'),
    },
  };
};

export default Conformance;
