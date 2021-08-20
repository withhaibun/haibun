import { Executor } from '../phases/Executor';
import { getTestEnv } from '../lib/TestSteps';
import { getDefaultWorld } from '../lib/util';
import { didNotOverwrite } from './vars';
import { WorldContext } from '../lib/contexts';

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
    const { world, vstep } = await getTestEnv(['vars'], 'set empty "x" to newValue', { ...getDefaultWorld().world, shared: new WorldContext({ x: 'notY' }) });
    const res = await Executor.doFeatureStep(vstep, world);
    
    expect(world.shared.get('x')).toBe('notY');
    expect(res.actionResults[0].details).toEqual(didNotOverwrite('x', 'notY', 'newValue'));
  });
});
