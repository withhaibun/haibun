import { OK, TNamed, AStepper } from '@haibun/core/build/lib/defs.js';
import { actionNotOK } from '@haibun/core/build/lib/util/index.js';

const WebHttp = class WebHttp extends AStepper {
  steps = {
    listening: {
      gwta: 'http {url} is listening',
      action: async ({ url }: TNamed) => {
        try {
          await fetch(url);
          return OK;
        } catch (e) {
          return actionNotOK(`${url} is not listening`, { topics: { result: { summary: 'error', details: e } } });
        }
      },
    },
    oidc_config: {
      gwta: 'http {url} has an oidc well-known configuration',
      action: async ({ url }: TNamed) => {
        const response = await fetch(`${url}/.well-known/openid-configuration`);
        const json = await response.json();
        return json.authorization_endpoint ? OK : actionNotOK(`${json} not recognized`, { topics: { result: { summary: 'json', details: json } } });
      },
    },
    hasContent: {
      gwta: 'fetch from {url} matches {what}',
      action: async ({ url, what }: TNamed) => {
        const response = await fetch(url);
        const text = await response.text();
        return text === what ? OK : actionNotOK(`${url} does not contain ${what}, it contains ${text}`)
      },
    },
  };
};

export default WebHttp;
