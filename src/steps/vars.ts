import { IStepper, IStepperConstructor, OK, TKeyString, TShared, TVStep } from '../lib/defs';

const vars: IStepperConstructor = class Vars implements IStepper {
  shared: TShared;
  constructor(shared: any) {
    this.shared = shared;
  }

  steps = {
    set: {
      gwta: 'set (empty )?(?<what>.+) to (?<value>.+)',
      section: 'Background',
      action: async ({ what, value }: TKeyString, vstep: TVStep) => {
        // FIXME hokey
        const emptyOnly = !vstep.in.match(/ set missing /);
        if (!emptyOnly || this.shared[what] === undefined) {
          this.shared[what] = value;
          return OK;
        }
        return { ...OK, details: didNotOverwrite(what, this.shared[what], value) };
      },
    },
    background: {
      match: /^Background: ?(?<background>.+)?$/,
      action: async ({ background }: TKeyString) => {
        this.shared.background = background;
        return OK;
      },
    },
    feature: {
      match: /^Feature: ?(?<feature>.+)?$/,
      action: async ({ feature }: TKeyString) => {
        this.shared.feature = feature;
        return OK;
      },
    },
    scenario: {
      match: /^Scenario: (?<scenario>.+)$/,
      action: async ({ scenario }: TKeyString) => {
        this.shared.scenario = scenario;
        return OK;
      },
    },
    display: {
      gwta: 'display (?<what>.+)',
      action: async ({ what }: TKeyString) => {
        console.log(what, 'is', this.shared[what]);

        return OK;
      },
    },
  };
};
export default vars;

export function didNotOverwrite(what: string, present: string, value: string) {
  `did not overwrite ${what} value of "${present}" with "${value}"`;
}
