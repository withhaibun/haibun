import { IStepper, IExtensionConstructor, OK, TKeyString, TVStep, TWorld } from '../lib/defs';
import { actionNotOK } from '../lib/util';

const vars: IExtensionConstructor = class Vars implements IStepper {
  world: TWorld;
  constructor(world: TWorld) {
    this.world = world;
  }

  steps = {
    set: {
      gwta: 'set( empty)? {what: string} to {value: string}',
      section: 'Background',
      action: async ({ what, value }: TKeyString, vstep: TVStep) => {
        // FIXME hokey
        const emptyOnly = !vstep.in.match(/ set missing /);
        
        if (!emptyOnly || this.world.shared[what] === undefined) {
          this.world.shared[what] = value;
          return OK;
        }
        return { ...OK, details: didNotOverwrite(what, this.world.shared[what], value) };
      },
    },
    /*
    onType: {
      gwta: 'on the {what} (?<type>[^ ]+)$',
      action: async({what, type}: TKeyString) => {
        console.log(what, type);
        // add an _onType var, store further values in [_onType][what]
        return actionNotOK('wow');
      }
    },
    forType: {
      gwta: 'for the {what} (?<type>[^ ]+)$',
      action: async({what, type}: TKeyString) => {
        console.log(what, type);
        // add an _forFor var, use [_onType][what] || [what]
        return actionNotOK('wow');
      }
    },
    */
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

export function didNotOverwrite(what: string, present: string, value: string) {
  `did not overwrite ${what} value of "${present}" with "${value}"`;
}
