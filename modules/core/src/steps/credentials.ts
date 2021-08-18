import { IStepper, IExtensionConstructor, OK, TWorld, TNamed } from '../lib/defs';

const Credentials: IExtensionConstructor = class Credentials implements IStepper {
  world: TWorld;

  constructor(world: TWorld) {
    this.world = world;
  }

  generateRandomUsername(ref: string) {
    this.world.shared.set(ref, ['rnd', Math.floor(Date.now() / 1000).toString(36), Math.floor(Math.random() * 1e8).toString(36)].join('_'));
    return this.world.shared.get(ref);
  }

  generateRandomPassword(ref: string) {
    this.world.shared.set(ref, [
      'testpass',
      Math.floor(Math.random() * 1e8)
        .toString(36)
        .toUpperCase(),
    ].join('_'));
    return this.world.shared.get(ref);
  }
  getRandom(name: string) {
    return this.world.shared.get(name);
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
