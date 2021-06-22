import { IStepper, IStepperConstructor, OK, TShared } from '../lib/defs';

const vars: IStepperConstructor = class Vars implements IStepper {
  shared: TShared;
  constructor(shared: any) {
    this.shared = shared;
  }

  steps = {
    is: {
      gwta: 'set (?<what>.+) to (?<value>.+)',
      section: 'Background',
      action: async ({ what, value }: { what: string; value: string }) => {
        this.shared[what] = value;
        return OK;
      },
    },
    background: {
      match: /^Background: ?(?<background>.+)?$/,
      action: async ({ background }: { background: string }) => {
        this.shared.background = background;
        return OK;
      },
    },
    feature: {
      match: /^Feature: ?(?<feature>.+)?$/,
      action: async ({ feature }: { feature: string }) => {
        this.shared.feature = feature;
        return OK;
      },
    },
    scenario: {
      match: /^Scenario: (?<scenario>.+)$/,
      action: async ({ scenario }: { scenario: string }) => {
        this.shared.scenario = scenario;
        return OK;
      },
    },
    display: {
      gwta: 'display (?<what>.+)',
      action: async ({ what }: { what: string }) => {
        console.log(what, 'is', this.shared[what]);

        return OK;
      },
    },
  };
};
export default vars;
