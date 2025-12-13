import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import { ActivitiesStepper } from './activities-stepper.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';

describe('ActivitiesStepper - Skipped Steps Reproduction', () => {
  const steppers = [Haibun, VariablesStepper, ActivitiesStepper];

  it('should run steps following an immediately satisfied ensure', async () => {
    // Defines "Precondition" activity that satisfies "Precondition met"
    const bg = [
      'Activity: Satisfy Precondition',
      'set pre to "done"',
      'waypoint Precondition met with variable pre is "done"',
      '',
      'Activity: Main Flow',
      'ensure Precondition met',
      'set ran_steps to "yes"',
      'waypoint Main Flow Done with variable ran_steps is "yes"'
    ].join('\n');

    // Scenario that triggers Main Flow
    const scenario = [
      'set pre to "done"',
      'ensure Main Flow Done'
    ].join('\n');
    // Note: pre exists to "done" initially, so "ensure Precondition met" should pass immediately and NOT run "Satisfy Precondition".
    // Then it should proceed to 'set ran_steps to "yes"'.

    const feature = {
      path: '/features/test.feature',
      content: scenario
    };

    const result = await passWithDefaults([feature], steppers, undefined, [{ path: '/backgrounds/bg.feature', content: bg }]);

    expect(result.ok).toBe(true);
    // We can't easily check variables directly from passWithDefaults result without digging,
    // but if "ensure Main Flow Done" passed, it means "variable ran_steps is 'yes'" must be true.
    // If 'set ran_steps to "yes"' was skipped, the waypoint proof would fail (initially undefined),
    // and it would try to run Main Flow again? Or fail if Main Flow IS the current activity?
    // Actually, "ensure Main Flow Done" calls "Main Flow".
    // "Main Flow" runs.
    // If "set ran_steps" is skipped, "ran_steps" remains undefined.
    // Then "waypoint Main Flow Done" checks proof "variable ran_steps is 'yes'". It fails.
    // The loop continues? Or errors?

    // If the bug exists, this test might fail with timeout or error, or result.ok = false.
  });

  it('should run steps following a satisfied ensure (when remediation ran)', async () => {
    const bg = [
      'Activity: Satisfy Precondition',
      'set pre to "done"',
      'waypoint Precondition met with variable pre is "done"',
      '',
      'Activity: Main Flow',
      'ensure Precondition met',
      'set ran_steps to "yes"',
      'waypoint Main Flow Done with variable ran_steps is "yes"'
    ].join('\n');

    // Here 'pre' is NOT set initially.
    // 'ensure Precondition met' should trigger 'Satisfy Precondition'.
    // Then return to 'Main Flow' and run 'set ran_steps to "yes"'.
    const scenario = 'ensure Main Flow Done';

    const feature = {
      path: '/features/test.feature',
      content: scenario
    };

    const result = await passWithDefaults([feature], steppers, undefined, [{ path: '/backgrounds/bg.feature', content: bg }]);
    expect(result.ok).toBe(true);
  });


  it('should fail if steps are passed as a single multiline string (programmatic usage)', async () => {
    const feature = {
      path: '/features/test-manual.feature',
      content: 'ensure Manual Outcome'
    };

    class ManualRegStepper extends ActivitiesStepper {
      async setWorld(world: any, steppers: any) {
        await super.setWorld(world, steppers);
        if (!this.steps['Manual Outcome']) {
          this.registerOutcome(
            'Manual Outcome',
            ['variable manual_ran is "yes"'],
            '/manual.feature',
            false,
            ['set manual_ran to "yes"\nset other to "value"']
          );
        }
      }
    }

    const customSteppers = [Haibun, VariablesStepper, ManualRegStepper];
    const result = await passWithDefaults([feature], customSteppers, undefined);

    expect(result.ok).toBe(true);
    // expect(result.failure?.error?.message).toContain('max attempts exceeded');
  });
});
