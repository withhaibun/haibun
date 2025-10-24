import { describe, it, expect } from 'vitest';
import { AStepper } from '../lib/astepper.js';
import { OK, TFeatureStep, TStepArgs, ExecMode } from '../lib/defs.js';
import { testWithDefaults, DEF_PROTO_OPTIONS } from '../lib/test/lib.js';
import { actionNotOK } from '../lib/util/index.js';
import { doExecuteFeatureSteps } from '../lib/util/featureStep-executor.js';
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
      action: async (args: TStepArgs) => {
        try {
          const steps = args.steps as unknown;
            if (!Array.isArray(steps)) throw new Error('steps must be feature steps');
          const last = await doExecuteFeatureSteps(steps as TFeatureStep[], [this as unknown as AStepper], this.getWorld(), ExecMode.NO_CYCLES);
          if (!last || !last.ok) {
            const msg = (last?.stepActionResult as { message?: string })?.message || 'inline statement failed';
            return actionNotOK(`statement failed: ${msg}`);
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
    const result = await testWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(true);
  });
  it('fails unknown statement', async () => {
    const feature = { path: '/features/test.feature', content: 'do gamma' };
    const result = await testWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(false);
  });
  it('executes multi-line backgrounds via statement list', async () => {
    // Compose statement referencing beta after alpha
  const feature = { path: '/features/test.feature', content: 'do alpha\nalpha\nbeta' };
    const result = await testWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(true);
  });
});
