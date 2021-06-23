
import { IStepper, IStepperConstructor, OK } from '../lib/defs';

const haibun: IStepperConstructor = class Haibun implements IStepper {
  steps = {
    prose: {
      gwta: '.*[\.?!]$',
      action: async () => OK
    }
  }
}

export default haibun;