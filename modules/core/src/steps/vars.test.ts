import { Executor } from '../phases/Executor';
import { getTestEnv } from '../lib/TestSteps';
import { getDefaultWorld } from '../lib/util';
import { didNotOverwrite } from './vars';
import { WorldContext } from '../lib/contexts';
import { TNotOKActionResult } from '../lib/defs';

describe('vars', () => {
  it('assigns', async () => {
    const { world, vstep } = await getTestEnv(['vars'], 'set x to y', getDefaultWorld().world);
    await Executor.doFeatureStep(vstep, world);

    expect(world.shared.get('x')).toBe('y');
  });
  it('assigns empty', async () => {
    const { world, vstep } = await getTestEnv(['vars'], 'set empty "x" to y', getDefaultWorld().world);
    await Executor.doFeatureStep(vstep, world);
    expect(world.shared.get('x')).toBe('y');
  });
  it('empty does not overwrite', async () => {
    const { world, vstep } = await getTestEnv(['vars'], 'set empty "x" to newValue', {
      ...getDefaultWorld().world,
      shared: new WorldContext('test vars empty does not overwrite', { x: 'notY' }),
    });
    const res = await Executor.doFeatureStep(vstep, world);

    expect(world.shared.get('x')).toBe('notY');
    expect(res.actionResults[0].topics).toEqual({ ...didNotOverwrite('x', 'notY', 'newValue') });
  });
  it('is not set', async () => {
    const { world, vstep } = await getTestEnv(['vars'], '"x 1" is set', { ...getDefaultWorld().world });
    const res = await Executor.doFeatureStep(vstep, world);
    expect(res.ok).toBe(false);
  });
  it('is set', async () => {
    const { world, vstep } = await getTestEnv(['vars'], '"x 1" is set', { ...getDefaultWorld().world, shared: new WorldContext('is set', { 'x 1': '1' }) });
    const res = await Executor.doFeatureStep(vstep, world);
    expect(res.ok).toBe(true);
  });
  it('is set with or', async () => {
    const { world, vstep } = await getTestEnv(['vars'], '"x 1" is set or do something', { ...getDefaultWorld().world });
    const res = await Executor.doFeatureStep(vstep, world);
    expect(res.ok).toBe(false);
    expect((res.actionResults[0] as TNotOKActionResult).message).toBe('x 1 not set: do something');
  });
});
