import { IStepper, IExtensionConstructor, OK, TWorld, TNamed } from '../lib/defs';

export const cred = (key: string) => `__cred_${key}`;

const Credentials: IExtensionConstructor = class Credentials implements IStepper {
  world: TWorld;

  constructor(world: TWorld) {
    this.world = world;
  }

  generateRandomUsername(ref: string) {
    this.world.shared.set(cred(ref), ['rnd', Math.floor(Date.now() / 1000).toString(36), Math.floor(Math.random() * 1e8).toString(36)].join('_'));
    return this.world.shared.get(cred(ref));
  }

  generateRandomPassword(ref: string) {
    this.world.shared.set(cred(ref), [
      'testpass',
      Math.floor(Math.random() * 1e8)
        .toString(36)
        .toUpperCase(),
    ].join('_'));
    return this.world.shared.get(cred(ref));
  }
  getRandom(name: string) {
    return this.world.shared.get(cred(name));
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
