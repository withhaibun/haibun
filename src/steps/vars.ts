import { IStepper, IStepperConstructor, ok, TFound, TStep, TVars } from "../lib/defs";

const Context: IStepperConstructor = class Context implements IStepper {
  vars: TVars;
  constructor(vars: any) {
    this.vars = vars;
  }
  close() {
  }

  steps = {
    is: {
      match: /^(?<what>.+) is (?<value>.+)$/g,
      action: async ({ what, value }: { what: string, value: string }) => {
        this.vars[what] = value;
        return ok;
      }
    },
    display: {
      match: /^I display (?<what>.+)$/g,
      action: async ({ what }: { what: string }) => {
        console.log(what, 'is', this.vars[what]);
        
        return ok;
      }
    },
  }
}
export default Context;