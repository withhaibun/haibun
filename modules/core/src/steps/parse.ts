import { actionNotOK, actionOK } from '../lib/util/index.js';
import { AStepper, OK, TNamed } from '../lib/defs.js';

const Parse = class Parse extends AStepper {
  steps = {
    must: {
      match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
      action: async (input: any) => actionNotOK('not implemented'),
    },
    fulfills: {
      gwta: 'fulfills: {what}',
      action: async () => {
        return actionOK();
      },
    },
    conformance: {
      gwta: `has annotated conformance doc from {where: string}`,
      action: async ({ where }: TNamed) => {
        try {
          // await parseMatches({ where: undefined }, this.getWorld().options.base as string, [conformance]);
        } catch (e: any) {
          return actionNotOK(e.message);
        }
        return OK;
      },
    },
  };
};

export default Parse;
