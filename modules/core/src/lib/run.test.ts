import { describe, it, expect } from 'vitest';

import { AStepper, OK } from './defs.js';
import { testWithDefaults } from './test/lib.js';
import TestSteps from './test/TestSteps.js';
import { TestStepsWithRequiredOptions } from './test/TestStepsWithOptions.js';

describe('run self-contained', () => {
  it('no backgrounds', async () => {
    const feature = { path: '/features/test.feature', content: `When I have a test\nThen it passes` };
    const result = await testWithDefaults([feature], [TestSteps]);

    expect(result.ok).toBe(true);
    expect(result.featureResults.length).toBe(1);
    const t = result.featureResults[0];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);
    expect(t.stepResults.length).toBe(2);
    expect(t.stepResults.every((r) => r.ok === true)).toBe(true);
  });
});

describe.skip('increments', () => {
  it('increments feature', async () => {
    const TS = class TS extends AStepper {
      steps = {
        test: {
          exact: 'The feature should be incremented',
          action: async () => {
            const { featureNum } = this.getWorld().tag;
            this.getWorld().shared.set('result', `${featureNum}`);
            return OK;
          },
        },
      };
    };
    const feature = { path: '/features/test.feature', content: `When I have a test` };
    const feature2 = { path: '/features/test.feature', content: `The feature should be incremented` };
    const verify = { path: '/features/test.feature', content: `result is "2"` };
    const { ok } = await testWithDefaults([feature, feature2, verify], [TestSteps, TS]);
    expect(ok).toBe(true);
  });
});

describe('run backgrounds', () => {
  it('background', async () => {
    const feature = { path: '/features/test.feature', content: `Backgrounds: included` };
    const background = { path: '/backgrounds/included.feature', content: `Then it passes` };
    const result = await testWithDefaults([feature], [TestSteps], undefined, [background]);

    expect(result.ok).toBe(true);

    expect(result.featureResults.length).toBe(1);
    const t = result.featureResults[0];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);

    expect(t.stepResults.length).toBe(1);
    expect(t.stepResults.every((r) => r.ok === true)).toBe(true);
  });
});

describe('fails', () => {
  it('fails', async () => {
    const feature = { path: '/features/test.feature', content: `When I fall` };
    const result = await testWithDefaults([feature], [TestSteps]);

    expect(result.ok).toBe(false);

    expect(result.failure?.stage).toBe('Resolve');

    expect(result.failure?.error.message.startsWith('no step found for When I fall')).toBe(true);
  });
});

describe('step fails', () => {
  it('step fails', async () => {
    const feature = { path: '/features/test.feature', content: `When I have a test\nThen it fails` };
    const result = await testWithDefaults([feature], [TestSteps]);

    expect(result.ok).toBe(false);

    expect(result.failure?.stage).toBe('Execute');
  });
});

describe('options', () => {
  it('missing required options', async () => {
    const feature = { path: '/features/test.feature', content: `have a stepper option` };
    const result = await testWithDefaults([feature], [TestStepsWithRequiredOptions]);
    expect(result.ok).toBe(false);

    expect(result.failure?.stage).toBe('RequiredOptions');
  });
});

describe('multiple', () => {
  it('fail and pass', async () => {
    const features = [
      { path: '/features/fails.feature', content: `When I have a test\nThen it fails` },
      { path: '/features/passes.feature', content: `When I have a test\nThen it passes` },
    ];

    const result = await testWithDefaults(features, [TestSteps]);

    expect(result.ok).toBe(false);
    expect(result.featureResults?.length).toBe(2);

    expect(result.failure?.stage).toBe('Execute');
  });
});

describe('step vars', () => {
  it('step vars', async () => {
    const features = [{ path: '/features/test.feature', content: `Backgrounds: vars\nThen it passes` }];
    const backgrounds = [{ path: '/backgrounds/vars.feature', content: `Given I set var to 1\nGiven I set Var 2 to 2\nSet Var 3 to 3` }];

    const result = await testWithDefaults(features, [TestSteps], undefined, backgrounds);

    expect(result.ok).toBe(true);

    const { shared } = result;
    expect(shared.get('var')).toBe('1');
    expect(shared.get('Var 2')).toBe('2');
    expect(shared.get('Var 3')).toBe('3');
  });
});

describe('handles exception', () => {
  it('handles exception', async () => {
    const feature = { path: '/features/test.feature', content: `When I throw an exception\nThen it passes` };
    const result = await testWithDefaults([feature], [TestSteps]);

    expect(result.ok).toBe(false);

    expect(result.featureResults?.length).toBe(1);
  });
});
