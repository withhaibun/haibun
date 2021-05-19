import { IStepper, IStepperConstructor, ok, TShared } from '../lib/defs';

const vars: IStepperConstructor = class Vars implements IStepper {
  shared: TShared;
  constructor(shared: any) {
    this.shared = shared;
  }

  steps = {
    is: {
      match: /^When (?<what>.+) is (?<value>.+)$/g,
      action: async ({ what, value }: { what: string; value: string }) => {
        this.shared[what] = value;
        return ok;
      },
    },
    feature: {
      match: /^Feature: (?<feature>.+)$/g,
      action: async ({ feature }: { feature: string }) => {
        this.shared.feature = feature;
        return ok;
      },
    },
    background: {
      match: /^Background: ?(?<background>.+)?$/g,
      action: async ({ background }: { background: string }) => {
        this.shared.background = background;
        return ok;
      },
    },
    scenarios: {
      match: /^Scenarios: (?<scenarios>.+)$/g,
      action: async ({ scenarios }: { scenarios: string }) => {
        this.shared.scenarios = scenarios;
        return ok;
      },
    },
    scenario: {
      match: /^Scenario: (?<scenario>.+)$/g,
      action: async ({ scenario }: { scenario: string }) => {
        this.shared.scenario = scenario;
        return ok;
      },
    },
    display: {
      match: /^Then I display (?<what>.+)$/g,
      action: async ({ what }: { what: string }) => {
        console.log(what, 'is', this.shared[what]);

        return ok;
      },
    },
  };
};
export default vars;
