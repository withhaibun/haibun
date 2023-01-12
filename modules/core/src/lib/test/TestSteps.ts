import { TNamed, AStepper } from '../defs.js';
import { actionNotOK, actionOK } from '../util/index.js';
import { WorkspaceContext } from '../contexts.js'

const TestSteps = class TestSteps extends AStepper {
  steps = {
    test: {
      exact: 'When I have a test',
      action: async (input: any) => actionOK(),
    },
    passes: {
      exact: 'Then the test should pass',
      action: async (input: any) => actionOK(),
    },
    fails: {
      exact: 'Then the test can fail',
      action: async (input: any) => actionNotOK('test'),
    },
    named: {
      match: /^Then the parameter (?<param>.+) is accepted$/,
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
    buildsWithFinalizer: {
      gwta: 'builds with finalizer',
      action: async () => actionOK(),
      build: async () => {
        return {
          ...actionOK(),
          finalize: (workspace: WorkspaceContext) => {
            this.getWorld().shared.set('done', 'ok');
          },
        };
      },
    },
  };
};


export default TestSteps;