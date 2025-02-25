
import { TNamed, AStepper } from '../defs.js';
import { actionNotOK, actionOK } from '../util/index.js';
import { WorkspaceContext } from '../contexts.js';

const TestSteps = class TestSteps extends AStepper {
  steps = {
    fails: {
      gwta: 'fails',
      action: async () => actionNotOK('test fail'),
    },
    test: {
      exact: 'have a test',
      action: async () => actionOK(),
    },
    passes: {
      exact: 'passes',
      action: async () => actionOK(),
    },
    named: {
      match: /^parameter (?<param>.+) is accepted$/,
      action: async ({ param }: TNamed) => {
        return param === 'x' ? actionOK() : actionNotOK('test');
      },
    },
    throws: {
      gwta: 'throw an exception',
      action: async () => {
        throw Error(`<Thrown for test case>`);
      },
    },
  };
};

export default TestSteps;


