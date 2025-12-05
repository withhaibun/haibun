import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import LogicStepper from './logic-stepper.js';
import VariablesStepper from './variables-stepper.js';

describe('some', () => {
  it('some finds a match among failures', async () => {
    const feature = {
      path: '/features/test.feature',
      content: `
        set of numbers is [1, 2, 3]
        some n in numbers is where set temp to {n}, variable temp is 2
      `
    };
    const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
    expect(result.ok).toBe(true);
  });

  it('some fails if no match', async () => {
    const feature = {
      path: '/features/test.feature',
      content: `
        set of numbers is [1, 2, 3]
        not some n in numbers is where set temp to {n}, variable temp is 4
      `
    };
    const result = await passWithDefaults([feature], [LogicStepper, VariablesStepper]);
    expect(result.ok).toBe(true);
  });
});
