import { describe, it, expect } from 'vitest';
import { OK, TStepperStep } from './defs.js';
import { AStepper } from './astepper.js';
import { testWithDefaults, DEF_PROTO_OPTIONS } from './test/lib.js';

class StatementTestStepper extends AStepper {
  steps: Record<string, TStepperStep> = {
  alpha: { exact: 'alpha', action: () => OK },
  beta: { exact: 'beta', action: () => OK },
    compound: {
      gwta: 'do {thing:statement} when {cause:statement}',
      // At this stage, successful resolution (Resolver) already validated sub-statements individually.
      // The action only needs to acknowledge that both resolved.
  action: () => OK,
    },
  };
}

describe('multi statement variables', () => {
  it('executes both embedded statements (validated by resolver)', async () => {
    const feature = { path: '/features/test.feature', content: 'do alpha when beta' };
    const result = await testWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(true);
  // Resolution success implies both embedded statements were individually valid
  });

  it('fails when first embedded statement is unknown', async () => {
    const feature = { path: '/features/test.feature', content: 'do gamma when beta' };
    const result = await testWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(false);
  // failure originates from resolver validation before compound action runs
  });

  it('fails when second embedded statement is unknown', async () => {
    const feature = { path: '/features/test.feature', content: 'do alpha when gamma' };
    const result = await testWithDefaults([feature], [StatementTestStepper], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(false);
  });
});
