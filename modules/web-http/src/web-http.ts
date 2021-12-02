import got from 'got';

import { OK, TNamed, AStepper } from '@haibun/core/build/lib/defs';
import { actionNotOK } from '@haibun/core/build/lib/util';

const WebHttp = class WebHttp extends AStepper {
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
        return (json as any).authorization_endpoint ? OK : actionNotOK(`${json} not recognized`, { topics: { result: { summary: 'json', details: json } } });
      },
    },
    hasContent: {
      gwta: 'fetch from {url} is {what}',
      action: async ({ url, what }: TNamed) => {
        const text = await got(url).text();
        return text === what ? OK : actionNotOK(`${url} does not contain ${what}, it contains ${text}`)
      },
    },
  };
};

export default WebHttp;
