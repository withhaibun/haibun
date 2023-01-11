import { OK, TNamed, AStepper } from '@haibun/core/build/lib/defs';
import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import { parseMatches } from './parse';

const conformance = /(?!\n|. )\b([A-Z].*? must .*?\.)/;

const ParseMD = class ParseMD extends AStepper {
  steps = {
    conformance: {
      gwta: `has annotated conformance doc from {where: string}`,
      action: async ({ where }: TNamed) => {
        try {
          parseMatches({ where: undefined }, this.getWorld().options.base as string, [conformance]);
        } catch (e: any) {
          return actionNotOK(e.message);
        }
        return OK;
      },
    },
  };
};

export default ParseMD;
