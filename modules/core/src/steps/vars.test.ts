import { it, expect, describe } from 'vitest';

import { FeatureExecutor } from '../phases/Executor.js';
import { getDefaultWorld, getTestEnv, testWithDefaults } from '../lib/test/lib.js';

describe('vars', () => {
  it('assigns', async () => {
    const feature = { path: '/features/test.feature', content: 'set x to 1' };
    const display = { path: '/features/display.feature', content: 'display x' };
    const verify = { path: '/features/verify.feature', content: 'x is "1"' };
    const res = await testWithDefaults([feature, display, verify], []);
    expect(res.ok).toBe(true);
  });
  it('assigns empty', async () => {
    const feature = { path: '/features/test.feature', content: 'set empty "x" to y' };
    const verify = { path: '/features/verify.feature', content: '"x" is "y"' };
    const res = await testWithDefaults([feature, verify], []);
    expect(res.ok).toBe(true);
  });
  it('empty does not overwrite', async () => {
    const feature = { path: '/features/test.feature', content: 'set empty "x" to y' };
    const notempty = { path: '/features/test.feature', content: 'set empty "x" to z' };
    const verify = { path: '/features/verify.feature', content: '"x" is "y"' };
    const res = await testWithDefaults([feature, notempty, verify], []);
    expect(res.ok).toBe(true);
  });
  it('is not set', async () => {
    const { world, vstep, steppers } = await getTestEnv(['vars'], '"x 1" is set', { ...getDefaultWorld(0).world });
    const res = await FeatureExecutor.doFeatureStep(steppers, vstep, world);
    expect(res.ok).toBe(false);
  });
  it('is set', async () => {
    const feature = { path: '/features/test.feature', content: 'set "x" to y' };
    const verify = { path: '/features/verify.feature', content: '"x" is set' };
    const res = await testWithDefaults([feature, verify], []);
    expect(res.ok).toBe(true);
  });
});
