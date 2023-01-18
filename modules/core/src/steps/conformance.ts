import { actionNotOK } from '../lib/util/index.js';
import { AStepper } from '../lib/defs.js';

const Conformance = class Conformance extends AStepper {
  steps = {
    must: {
      match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
      action: async (input: any) => actionNotOK('not implemented'),
    },
  };
};

export default Conformance;
