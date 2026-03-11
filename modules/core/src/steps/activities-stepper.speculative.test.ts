import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import { ActivitiesStepper } from './activities-stepper.js';
import TestSteps from '../lib/test/TestSteps.js';
import LogicStepper from './logic-stepper.js';

describe('ActivitiesStepper speculative execution', () => {
  it('should not fail hard when running activity body speculatively', async () => {
    const feature = {
      path: '/features/test.feature',
      content: `
        Activity: Fail
        fails
        waypoint Fail with fails

        not ensure Fail
      `
    };
    // If 'fails' runs authoritatively, it might log errors or cause issues.
    // But mainly we want to ensure the test passes (meaning 'not' caught the failure).
    // If 'ensure Fail' throws or fails hard, 'not' might not catch it correctly or we might see error logs.
    const result = await passWithDefaults([feature], [ActivitiesStepper, LogicStepper, TestSteps]);
    expect(result.ok).toBe(true);
  });

  it('should not fail hard when verifying proof speculatively', async () => {
     const feature = {
      path: '/features/test.feature',
      content: `
        Activity: FailProof
        passes
        waypoint FailProof with fails

        not ensure FailProof
      `
    };
    // Here activity body passes, but proof verification fails.
    // 'ensure FailProof' should fail. 'not' should pass.
    const result = await passWithDefaults([feature], [ActivitiesStepper, LogicStepper, TestSteps]);
    expect(result.ok).toBe(true);
  });
});
