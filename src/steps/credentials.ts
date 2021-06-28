import { IStepper, IStepperConstructor, OK, TWorld } from '../lib/defs';

const Credentials: IStepperConstructor = class Credentials implements IStepper {
  world: TWorld;

  constructor(world: TWorld) {
    this.world = world;
  }

  generateRandomUsername(ref: string) {
    this.world.shared[ref] = ['rnd', Math.floor(Date.now() / 1000).toString(36), Math.floor(Math.random() * 1e8).toString(36)].join('_');
    return this.world.shared[ref];
  }

  generateRandomPassword(ref: string) {
    this.world.shared[ref] = [
      'testpass',
      Math.floor(Math.random() * 1e8)
        .toString(36)
        .toUpperCase(),
    ].join('_');
    return this.world.shared[ref];
  }
  getRandom(name: string) {
    const val = this.world.shared[name];
    return val;
  }

  steps = {
    hasRandomUsername: {
      match: /^When I have a valid random username <(?<name>.+)>/,
      action: async ({ name }: { name: string }) => {
        this.generateRandomUsername(name);
        return OK;
      },
    },

    hasRandomPassword: {
      match: /^When I have a valid random password <(?<name>.+)>/,
      action: async ({ name }: { name: string }) => {
        this.generateRandomPassword(name);
        return OK;
      },
    },
  };
};
export default Credentials;
