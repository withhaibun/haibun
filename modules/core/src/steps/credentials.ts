import { OK, TNamed, AStepper } from '../lib/defs.js';

export const cred = (key: string) => `__cred_${key}`;

const Credentials = class Credentials extends AStepper {
  generateRandomUsername(ref: string) {
    this.getWorld().shared.set(cred(ref), ['rnd', Math.floor(Date.now() / 1000).toString(36), Math.floor(Math.random() * 1e8).toString(36)].join('_'));
    return this.getWorld().shared.get(cred(ref));
  }

  generateRandomPassword(ref: string) {
    this.getWorld().shared.set(
      cred(ref),
      [
        'testpass',
        Math.floor(Math.random() * 1e8)
          .toString(36)
          .toUpperCase(),
      ].join('_')
    );
    return this.getWorld().shared.get(cred(ref));
  }
  getRandom(name: string) {
    return this.getWorld().shared.get(cred(name));
  }

  steps = {
    hasRandomUsername: {
      match: /^When I have a valid random username <(?<name>.+)>/,
      action: async ({ name }: TNamed) => {
        this.generateRandomUsername(name);
        return OK;
      },
    },

    hasRandomPassword: {
      match: /^When I have a valid random password <(?<name>.+)>/,
      action: async ({ name }: TNamed) => {
        this.generateRandomPassword(name);
        return OK;
      },
    },
  };
};
export default Credentials;
