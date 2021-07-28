import got from 'got';

import {  IStepper, IExtensionConstructor, OK, TResult, TWorld } from '@haibun/core/build/lib/defs';
import { actionNotOK } from '@haibun/core/build/lib/util';

const WebHttp: IExtensionConstructor = class WebHttp implements IStepper {
  world: TWorld;
  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    listening: {
      gwta: '{what} is listening',
      action: async ({ what }: { what: string }) => {
        console.log('what', what)
        const res = await got.get(what);
        console.log(res);
        
        return actionNotOK('wtw');
      },
    },
    oidc_config: {
      gwta: '{what} has a well-known configuration',
      action: async ({ what }: { what: string }) => {
        return actionNotOK('wtw');
      },
    },
  };
};

export default WebHttp;