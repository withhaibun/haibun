import { describe, it, expect } from 'vitest';
import { AStepper } from '../lib/astepper.js';
import { TFeatureStep, ExecMode } from '../lib/defs.js';
import { OK, TStepArgs } from '../schema/protocol.js';
import { passWithDefaults, DEF_PROTO_OPTIONS, failWithDefaults } from '../lib/test/lib.js';
import { actionNotOK } from '../lib/util/index.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';

class StatementTestStepper extends AStepper {
  steps = {
    alpha: {
      exact: 'alpha',
      action: async () => Promise.resolve(OK),
    },
    beta: {
      exact: 'beta',
      action: async () => Promise.resolve(OK),
    },
    do: {
      gwta: `do {steps:${DOMAIN_STATEMENT}}`,
      action: async (args: TStepArgs, featureStep: TFeatureStep) => {
        try {
          const steps = args.steps as unknown;
          if (!Array.isArray(steps)) throw new Error('steps must be feature steps');

          const runner = new FlowRunner(this.getWorld(), [this as unknown as AStepper]);
          const result = await runner.runSteps(steps as TFeatureStep[], { intent: { mode: 'authoritative' }, parentStep: featureStep });

          if (result.kind !== 'ok') {
            return actionNotOK(`statement failed: ${result.message}`);
          }
          return OK;
        } catch (e) {
          return actionNotOK(`statement failed: ${(e as Error).message}`);
        }
      }
    }
  }
}

describe('statement type', () => {
  it('executes single known statement', async () => {
    const feature = { path: '/features/test.feature', content: 'do alpha' };
    const result = await passWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(true);
  });
  it('fails unknown statement', async () => {
    const feature = { path: '/features/test.feature', content: 'do gamma' };
    const result = await failWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(false);
  });
  it('executes multi-line backgrounds via statement list', async () => {
    // Compose statement referencing beta after alpha
    const feature = { path: '/features/test.feature', content: 'do alpha\nalpha\nbeta' };
    const result = await passWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(true);
  });
});
