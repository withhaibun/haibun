import { OK, TNamed, AStepper, TWorld, TVStep } from '../lib/defs.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, findStepper, sleep } from '../lib/util/index.js';
import { EVENT_AFTER } from '../phases/Builder.js';

const Haibun = class Haibun extends AStepper {
  steppers: AStepper[];
  setWorld(world: TWorld, steppers: AStepper[]): void {
    this.steppers = steppers;
    this.world = world;
  }
  steps = {
    prose: {
      gwta: '.*[.?!]$',
      action: async () => OK,
    },
    sequenceToken: {
      gwta: 'a sequence token {token}',
      action: async ({ token }: TNamed) => {
        this.getWorld().shared.set(token, '' + new Date().getTime());
        return OK;
      },
    },
    startStepDelay: {
      gwta: 'start step delay of (?<ms>.+)',
      action: async ({ ms }: TNamed) => {
        this.getWorld().options.step_delay = parseInt(ms, 10);
        return OK;
      },
    },
    fails: {
      gwta: `fails with {message}`,
      action: async ({ message }: TNamed) => {
        return actionNotOK(`fails: ${message}`);
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
      action: async () => {
        this.world?.logger.log(`env: ${JSON.stringify(this.world.options.env)}`);
        return OK;
      },
    },
    showTag: {
      gwta: 'show stepper tag {which}',
      action: async ({ which }: TNamed) => {
        const what = which ? (this.getWorld().tag as any)[which] : this.getWorld().tag;
        this.world?.logger.log(`tag ${which}: ${JSON.stringify(what)}`);
        return OK;
      },
    },
    afterEvery: {
      gwta: 'after every {domainID}, {action}',
      action: async ({ domainID, action }: TNamed) => {
        return OK;
      },
      build: async ({ domainID, action }: TNamed, vstep: TVStep, workspace, resolver: Resolver, steppers: AStepper[]) => {
        const found = await this.findAction(action, resolver, steppers);

        if (found) {
          workspace.set(`${EVENT_AFTER}:${domainID}`, { action, vstep });
          return { ...OK, workspace };
        }
        return actionNotOK(`forEvery: action ${action} not found for ${domainID}`)
      }
    },
    until: {
      gwta: 'until {what} is {value}',
      action: async ({ what, value }: TNamed) => {
        while (this.getWorld().shared.values[what] !== value) {
          await sleep(100);
        }
        return OK;
      },
    },
    pauseSeconds: {
      gwta: 'pause for {ms}s',
      action: async ({ ms }: TNamed) => {
        const seconds = parseInt(ms, 10) * 1000;
        await sleep(seconds);
        return OK;
      },
    },
    comment: {
      gwta: '#{comment}',
      action: async () => {
        return OK;
      },
    },
  };
  findAction = (action: string, resolver: Resolver, steppers) => {

    const found = resolver.findActionableSteps(action);

    if (found?.length === 1) {
      return findStepper<AStepper>(steppers, found[0].stepperName);
    }
    return undefined;
  }
};

export default Haibun;
