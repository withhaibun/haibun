import { IStepper, IExtensionConstructor, OK, TKeyString, TVStep, TWorld, TShared } from '../lib/defs';

const vars: IExtensionConstructor = class Vars implements IStepper {
  world: TWorld;
  constructor(world: TWorld) {
    this.world = world;
  }

  async set({ what, value }: TKeyString, vstep: TVStep) {
    // FIXME hokey
    const missingOnly = vstep.in.match(/ set missing /);
    
    if (missingOnly || this.world.shared[what] === undefined) {
      this.world.shared[what] = value;
      return OK;
    }
    return { ...OK, details: didNotOverwrite(what, this.world.shared[what], value) };
  }
  async type({ what, type }: TKeyString) {
    this.world.shared[`_${type}`] = what;
    console.log('ww', what, this.world.shared);

    // add an _onType var, store further values in [_onType][what]
    return OK;
  }
  steps = {
    set: {
      gwta: 'set( empty)? {what: string} to {value: string}',
      action: this.set.bind(this),
      build: this.set.bind(this),
    },
    onType: {
      gwta: 'on the {what} {type}$',
      action: this.type.bind(this),
      build: this.type.bind(this),
    },
    background: {
      match: /^Background: ?(?<background>.+)?$/,
      action: async ({ background }: TKeyString) => {
        this.world.shared.background = background;
        return OK;
      },
    },
    feature: {
      match: /^Feature: ?(?<feature>.+)?$/,
      action: async ({ feature }: TKeyString) => {
        this.world.shared.feature = feature;
        return OK;
      },
    },
    scenario: {
      match: /^Scenario: (?<scenario>.+)$/,
      action: async ({ scenario }: TKeyString) => {
        this.world.shared.scenario = scenario;
        return OK;
      },
    },
    display: {
      gwta: 'display (?<what>.+)',
      action: async ({ what }: TKeyString) => {
        this.world.logger.log(`${what} is ${this.world.shared[what]}`);

        return OK;
      },
    },
  };
};
export default vars;

export const didNotOverwrite = (what: string, present: string | TShared, value: string) => `did not overwrite ${what} value of "${present}" with "${value}"`;
