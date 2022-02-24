import { OK, TNamed, AStepper } from '../lib/defs';
import { actionOK, sleep } from '../lib/util';

const Haibun = class Haibun extends AStepper {
  steps = {
    prose: {
      gwta: '.*[.?!]$',
      action: async () => OK,
    },
    sendFeatures: {
      gwta: 'send features',
      action: async () => {
        return actionOK({ features: this.getWorld().shared.values._features });
      },
    },
    startStepDelay: {
      gwta: 'start step delay of (?<ms>.+)',
      action: async ({ ms }: TNamed) => {
        this.getWorld().options.step_delay = parseInt(ms, 10);
        return OK;
      },
    },
    stopStepDelay: {
      gwta: 'stop step delay',
      action: async () => {
        return OK;
      },
    },
    displayEnv: {
      gwta: 'show the environment',
      action: async (a: TNamed) => {
        this.world?.logger.log(`env: ${JSON.stringify(this.world.options.env)}`)
        return OK;
      }
    },
    pauseSeconds: {
      gwta: 'pause for {ms}s',
      action: async ({ ms }: TNamed) => {
        const seconds = parseInt(ms, 10) * 1000;
        await sleep(seconds);
        return OK;
      },
    },
  };
};

export default Haibun;
