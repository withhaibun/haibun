import { FeatureExecutor } from '../phases/Executor';
import {  getDefaultWorld, getTestEnv, testWithDefaults } from '../lib/test/lib';
import { TNotOKActionResult } from '../lib/defs';

describe.skip('vars', () => {
  it('assigns', async () => {
    const feature = { path: '/features/test.feature', content: 'set "x" to y' };
    const verify = { path: '/features/verify.feature', content: 'x is "y"' };
    const { world } = getDefaultWorld(0);
    const { ok } = await testWithDefaults([feature, verify], [], world);
    expect(ok).toBe(true);
  });
  it('assigns empty', async () => {
    const feature = { path: '/features/test.feature', content: 'set empty "x" to y' };
    const verify = { path: '/features/verify.feature', content: 'x is "y"' };
    const { ok } = await testWithDefaults([feature, verify], [], getDefaultWorld(0).world);
    expect(ok).toBe(true);
  });
  it('empty does not overwrite', async () => {
    const feature = { path: '/features/test.feature', content: 'set empty "x" to y' };
    const notempty = { path: '/features/test.feature', content: 'set empty "x" to z' };
    const verify = { path: '/features/verify.feature', content: 'x is "y"' };
    const { ok } = await testWithDefaults([feature, notempty, verify], [], getDefaultWorld(0).world);
    expect(ok).toBe(true);
    // expect(res.actionResults[0].topics).toEqual({ ...didNotOverwrite('x', 'notY', 'newValue') });
  });
  it('is not set', async () => {
    const { world, vstep, steppers } = await getTestEnv(['vars'], '"x 1" is set', { ...getDefaultWorld(0).world });
    const res = await FeatureExecutor.doFeatureStep(steppers, vstep, world);
    expect(res.ok).toBe(false);
  });
  it('is set', async () => {
    const feature = { path: '/features/test.feature', content: 'set "x" to y' };
    const verify = { path: '/features/verify.feature', content: 'x is set' };
    const result = await testWithDefaults([feature, verify], [], getDefaultWorld(0).world);
    
    // expect(ok).toBe(true);
  });
  it('is set with or', async () => {
    const { world, vstep, steppers } = await getTestEnv(['vars'], '"x 1" is set or do something', { ...getDefaultWorld(0).world });
    const res = await FeatureExecutor.doFeatureStep(steppers, vstep, world);
    expect(res.ok).toBe(false);
    expect((res.actionResults[0] as TNotOKActionResult).message).toBe('x 1 not set: do something');
  });
});
