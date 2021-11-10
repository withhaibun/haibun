import { Executor } from '../phases/Executor';
import { getDefaultWorld, getTestEnv } from '../lib/test/lib';

describe('haibun', () => {
  it('finds prose', async () => {
    const { world, vstep } = await getTestEnv(['haibun'], 'A sentence.', getDefaultWorld(0).world);
    const res = await Executor.doFeatureStep(vstep, world);
    
    expect(res.ok).toBe(true);
    expect(res.actionResults[0].name).toBe('prose');
  });
});
