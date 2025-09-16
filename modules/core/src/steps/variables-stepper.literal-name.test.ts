import { describe, it, expect } from 'vitest';
import VariablesStepper from './variables-stepper.js';
import { testWithDefaults } from '../lib/test/lib.js';
import { DEFAULT_DEST } from '../lib/defs.js';

const varsStepper = [VariablesStepper];

describe('variable name literal handling', () => {
  it('set uses literal name even if env collides', async () => {
    const feature = { path: '/f.feature', content: 'set what to "value"' };
    const envVariables = { what: 'ENV' };
    const { world } = await testWithDefaults([feature], varsStepper, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
    expect(world.shared.get('what')).toBe('value');
  });
  it('combine uses literal name even if env collides', async () => {
    const feature = { path: '/f.feature', content: 'set a to "A"\nset b to "B"\ncombine a and b as what' };
    const envVariables = { what: 'ENV' };
    const { world } = await testWithDefaults([feature], varsStepper, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
    expect(world.shared.get('what')).toBe('AB');
  });
});
