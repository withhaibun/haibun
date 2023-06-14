import { OK, TNamed, AStepper } from '@haibun/core/build/lib/defs.js';
import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import { parseMatches } from './parse.js';

const conformance = /(?!\n|. )\b([A-Z].*? must .*?\.)/;

const ParseMD = class ParseMD extends AStepper {
  steps = {
    conformance: {
      gwta: `has annotated conformance doc from {where: string}`,
      action: async ({ where }: TNamed) => {
        try {
          await parseMatches({ where: undefined }, this.getWorld().options.base as string, [conformance]);
        } catch (e: any) {
          return actionNotOK(e.message);
        }
        return OK;
      },
    },
  };
};

export default ParseMD;
