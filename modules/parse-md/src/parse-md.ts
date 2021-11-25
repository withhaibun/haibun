import { IStepper, IExtensionConstructor, OK, TWorld, TNamed } from '@haibun/core/build/lib/defs';
import { actionNotOK } from '@haibun/core/build/lib/util';
import { parseMatches } from './parse';

const conformance = /(?!\n|. )\b([A-Z].*? must .*?\.)/;

const ParseMD: IExtensionConstructor = class ParseMD implements IStepper {
  world: TWorld;

  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    conformance: {
      gwta: `has annotated conformance doc from {where: string}`,
      action: async ({ where }: TNamed) => {
        console.debug('w', where);
        
        try {
          parseMatches([where], this.world.options.base as string, [conformance]);
        } catch (e: any) {
          return actionNotOK(e.message);
        }
        return OK;
      },
    },
  };
};

export default ParseMD;
