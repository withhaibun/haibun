import got from 'got';

import { IStepper, IExtensionConstructor, OK, TWorld, TNamed } from '@haibun/core/build/lib/defs';
import { actionNotOK } from '@haibun/core/build/lib/util';

const WebHttp: IExtensionConstructor = class WebHttp implements IStepper {
  world: TWorld;
  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    listening: {
      gwta: 'http {url} is listening',
      action: async ({ url }: TNamed) => {
        await got.get({ url, throwHttpErrors: false });
        return OK;
      },
    },
    oidc_config: {
      gwta: 'http {url} has an oidc well-known configuration',
      action: async ({ url }: TNamed) => {
        const json = await got.get({ url: `${url}/.well-known/openid-configuration` }).json();
        return (json as any).authorization_endpoint ? OK : actionNotOK(`${json} not recognized`);
      },
    },
  };
};

export default WebHttp;
