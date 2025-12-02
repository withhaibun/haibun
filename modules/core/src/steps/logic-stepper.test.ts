import { describe, it, expect } from 'vitest';

import { DEF_PROTO_OPTIONS, failWithDefaults, passWithDefaults } from '../lib/test/lib.js';
import TestSteps from '../lib/test/TestSteps.js';
import LogicStepper from './logic-stepper.js';
import VariablesSteppers from './variables-stepper.js';
import Haibun from './haibun.js';

describe('not', () => {
  it('not passes', async () => {
    const feature = { path: '/features/test.feature', content: 'not fails' };
    const result = await passWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(true);
  });

  it('not what missing', async () => {
    const feature = { path: '/features/test.feature', content: 'not doesnotexist' };
    const result = await failWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(false);
  });

  it('not condition true', async () => {
    const feature = { path: '/features/test.feature', content: 'not fails' };
    const result = await passWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(true);
  });

  it('not condition false', async () => {
    const feature = { path: '/features/test.feature', content: 'not passes' };
    const result = await failWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(false);
  });
});

describe('whenever', () => {
  it('whenever when missing', async () => {
    const feature = { path: '/features/test.feature', content: 'whenever doesnotexist, ends with OK' };
    const result = await failWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(false);
  });

  it('whenever what missing', async () => {
    const feature = { path: '/features/test.feature', content: 'whenever passes, doesnotexist' };
    const result = await failWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(false);
  });
});

describe('compound', () => {
  it('not not passes', async () => {
    const feature = { path: '/features/test.feature', content: 'not not passes' };
    const result = await passWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(true);
  });

  it('not not fails', async () => {
    const feature = { path: '/features/test.feature', content: 'not not fails' };
    const result = await failWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(false);
  });

  it('not not not invalid', async () => {
    const feature = {
      path: '/features/test.feature', content: 'not not who\'s there'
    };
    const result = await failWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(false);
  });

  it('not whenever passes, fails', async () => {
    const feature = { path: '/features/test.feature', content: 'not whenever passes, fails' };
    const result = await passWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(true);
  });

  it('whenever not passes, fails', async () => {
    const feature = { path: '/features/test.feature', content: 'whenever not passes, fails' };
    const result = await passWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(true);
  });
});

describe('variable composition', () => {
  it('not variable set is set fails', async () => {
    const feature = { path: '/features/test.feature', content: 'set wtw to 5\nnot variable "wtw" is set' };
    const result = await failWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(false); // inner isSet passes so not fails
  });

  it('whenever not variable unset executes body', async () => {
    const feature = { path: '/features/test.feature', content: 'whenever not variable "fresh" is set, set fresh to 1\nvariable "fresh" is "1"' };
    const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(true);
    expect(result.world.shared.get('fresh')).toBe('1');
  });

  it('whenever not variable set skips body', async () => {
    const feature = { path: '/features/test.feature', content: 'set existing to 2\nwhenever not variable "existing" is set, set existing to 3\nvariable "existing" is "2"' };
    const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(true);
    expect(result.world.shared.get('existing')).toBe('2');
  });

  it('whenever not variable set skips failing body', async () => {
    const feature = { path: '/features/test.feature', content: 'set existing to 2\nwhenever not variable "existing" is set, fails' };
    const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(true); // condition false, body skipped
  });

  it('not where variable set, passes (body passes so not fails)', async () => {
    const feature = { path: '/features/test.feature', content: 'set a to 1\nnot where variable "a" is set, passes' };
    const result = await failWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(false); // inner where ok -> not fails
  });

  it('not where variable unset, passes (condition false so where ok then not fails)', async () => {
    const feature = { path: '/features/test.feature', content: 'not where variable "ghost" is set, passes' };
    const result = await failWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(false); // inner where ok (skipped) -> not fails
  });

  it('not where variable set, failing body (where body fails so not passes)', async () => {
    const feature = { path: '/features/test.feature', content: 'set a to 1\nnot where variable "a" is set, fails' };
    const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(true); // inner where fails -> not passes
  });

  it('not variable unset is set passes', async () => {
    const feature = { path: '/features/test.feature', content: 'not variable "unset" is set' };
    const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(true);
    const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
    // nested variable check then parent not then ends with
    expect(seqs).toEqual([[1, 1, 1, -1], [1, 1, 1]]);
  });

  it('deeply nested negation with variable "who" demonstrates seqPath hierarchy', async () => {
    // Tests that nested negations properly extend seqPath with -1 at each level.
    // Validates the complete execution trace through four meta-levels.
    const feature = {
      path: '/features/test.feature',
      content: 'set who to "there"\nnot not not not variable "who" is "there"'
    };
    const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(true);

    const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
    // Verifies seqPath structure through recursive descent and ascent:
    // [1,1,1] - variable assignment
    // [1,1,2,-1,-1,-1,-1] - innermost condition evaluation
    // [1,1,2,-1,-1,-1] - third negation layer
    // [1,1,2,-1,-1] - second negation layer
    // [1,1,2,-1] - first negation layer
    // [1,1,2] - final statement resolution
    expect(seqs).toEqual([[1, 1, 1], [1, 1, 2, -1, -1, -1, -1], [1, 1, 2, -1, -1, -1], [1, 1, 2, -1, -1], [1, 1, 2, -1], [1, 1, 2]]);
    expect(seqs.length).toBe(6);
  });

  it('where-not-where demonstrates nested conditional evaluation with contradictory conditions', async () => {
    // Tests behavior when outer where condition succeeds but inner where condition
    // contradicts it. Verifies that inner where with false condition succeeds vacuously
    // and that all conditions and resolutions are recorded in stepResults.
    const feature = {
      path: '/features/test.feature',
      content: 'set who to "there"\nwhere variable "who" is "there", where not variable "who" is "there", passes'
    };
    const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers]);
    expect(result.ok).toBe(true); // outer succeeds, inner condition fails but where succeeds, body never runs

    const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
    // Validates complete execution trace with nested conditions:
    // [1,1,1] - variable assignment
    // [1,1,2,-1] - outer where condition evaluation (succeeds)
    // [1,1,2,1,-1,-1] - inner not's deepest evaluation
    // [1,1,2,1,-1] - inner not resolution (evaluates to false)
    // [1,1,2,1] - inner where resolution (condition false, succeeds without executing body)
    // [1,1,2] - outer where resolution (consequence executed successfully)
    expect(seqs).toEqual([[1, 1, 1], [1, 1, 2, -1], [1, 1, 2, 1, -1, -1], [1, 1, 2, 1, -1], [1, 1, 2, 1], [1, 1, 2]]);
    expect(seqs.length).toBe(6);
  });
});

describe('backgrounds', () => {
  it('where condition with backgrounds', async () => {
    const feature = { path: '/features/test.feature', content: 'where passes, Backgrounds: bg' };
    const background = { path: '/backgrounds/bg.feature', content: 'set ran to true\nends with ok' };
    const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
    expect(result.ok).toBe(true);

    expect(result.world.shared.get('ran')).toBe('true')

    const steps = result.featureResults![0].stepResults;
    // All steps recorded: condition, background steps, then parent where
    expect(steps.length).toBe(4);
    const seqs = steps.map(s => s.seqPath);
    expect(seqs).toEqual([[1, 1, 1, -1], [1, 1, 1, 1], [1, 1, 1, 2], [1, 1, 1]]);
  });

  it('invalid background fails during Resolve', async () => {
    const feature = { path: '/features/test.feature', content: 'whenever passes, Backgrounds: nonexistent' };
    const result = await failWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, []);
    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('Resolve');
    expect(result.failure?.error.message).toMatch(/can't find single "nonexistent.feature"/);
  });
});
describe('any of', () => {
  it('any of passes if one passes', async () => {
    const feature = { path: '/features/test.feature', content: 'any of passes, fails' };
    const result = await passWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(true);
  });

  it('any of fails if all fail', async () => {
    const feature = { path: '/features/test.feature', content: 'any of fails, fails' };
    const result = await failWithDefaults([feature], [LogicStepper, TestSteps]);
    expect(result.ok).toBe(false);
  });
});
