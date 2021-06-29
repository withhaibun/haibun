import { actionNotOK } from 'src/lib/util';
import { IStepper, IExtensionConstructor } from '../lib/defs';

const Conformance: IExtensionConstructor = class Conformance implements IStepper {
  steps = {
    must: {
      match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
      action: async (input: any) => actionNotOK('not implemented'),
    },
  };
};

export default Conformance;
