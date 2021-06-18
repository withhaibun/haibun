import { IStepper, IStepperConstructor, ok, TShared } from '../lib/defs';

const vars: IStepperConstructor = class Vars implements IStepper {
  shared: TShared;
  constructor(shared: any) {
    this.shared = shared;
  }

  steps = {
    is: {
      gwta: '(?<what>.+) is (?<value>.+)',
      action: async ({ what, value }: { what: string; value: string }) => {
        this.shared[what] = value;
        return ok;
      },
    },
    feature: {
      match: /^Feature: (?<feature>.+)$/,
      action: async ({ feature }: { feature: string }) => {
        this.shared.feature = feature;
        return ok;
      },
    },
    background: {
      match: /^Background: ?(?<background>.+)?$/,
      action: async ({ background }: { background: string }) => {
        this.shared.background = background;
        return ok;
      },
    },
    scenario: {
      match: /^Scenario: (?<scenario>.+)$/,
      action: async ({ scenario }: { scenario: string }) => {
        this.shared.scenario = scenario;
        return ok;
      },
    },
    display: {
      gwta: 'display (?<what>.+)',
      action: async ({ what }: { what: string }) => {
        console.log(what, 'is', this.shared[what]);

        return ok;
      },
    },
  };
};
export default vars;
