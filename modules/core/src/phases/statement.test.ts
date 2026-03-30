import { describe, it, expect } from 'vitest';
import { AStepper } from '../lib/astepper.js';
import { TFeatureStep } from '../lib/defs.js';
import { OK, TStepArgs } from '../schema/protocol.js';
import { passWithDefaults, DEF_PROTO_OPTIONS, failWithDefaults } from '../lib/test/lib.js';
import { actionNotOK } from '../lib/util/index.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import Haibun from '../steps/haibun.js';

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

          if (!result.ok) {
            return actionNotOK(`statement failed: ${result.errorMessage}`);
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
  it('domain statement substeps get extended seqPaths', async () => {
    const feature = { path: '/features/test.feature', content: 'do alpha' };
    const result = await passWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(true);
    const stepResults = result.featureResults![0].stepResults;
    const parentStep = stepResults.find(s => s.in === 'do alpha');
    const subStep = stepResults.find(s => s.in === 'alpha');
    expect(parentStep).toBeDefined();
    expect(subStep).toBeDefined();
    // Substep seqPath extends the parent's with an additional element
    expect(subStep!.seqPath.length).toBeGreaterThan(parentStep!.seqPath.length);
  });
  it('seqPaths start at 1 per scenario and substeps extend with new elements', async () => {
    const feature = { path: '/features/test.feature', content: 'Scenario: first\ndo alpha\nalpha\nScenario: second\nbeta' };
    const result = await passWithDefaults([feature], [StatementTestStepper, Haibun], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(true);
    const steps = result.featureResults![0].stepResults;
    // Scenario 1: "do alpha" is the first real step, seq starts at 1
    const doAlpha = steps.find(s => s.in === 'do alpha');
    expect(doAlpha!.seqPath[2]).toBe(1);
    // "alpha" substep from domain statement extends with additional seqPath element
    const alphaSubstep = steps.find(s => s.in === 'alpha' && s.seqPath.length > 3);
    expect(alphaSubstep).toBeDefined();
    expect(alphaSubstep!.seqPath.length).toBeGreaterThan(doAlpha!.seqPath.length);
    // "alpha" as direct step (step 2 in scenario 1)
    const alphaDirect = steps.find(s => s.in === 'alpha' && s.seqPath.length === 3);
    expect(alphaDirect!.seqPath[2]).toBe(2);
    // Scenario 2: "beta" resets — first real step is seq 1
    const beta = steps.find(s => s.in === 'beta');
    expect(beta!.seqPath[2]).toBe(1);
    // Scenario numbers should differ
    expect(doAlpha!.seqPath[1]).not.toBe(beta!.seqPath[1]);
  });
});
