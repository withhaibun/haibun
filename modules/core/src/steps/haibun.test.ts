import { FeatureExecutor } from '../phases/Executor';
import { getDefaultWorld, getTestEnv } from '../lib/test/lib';

describe('haibun', () => {
  it('finds prose', async () => {
    const { world, vstep, steppers } = await getTestEnv(['haibun'], 'A sentence.', getDefaultWorld(0).world);
    const res = await FeatureExecutor.doFeatureStep(steppers, vstep, world);

    expect(res.ok).toBe(true);
    expect(res.actionResults[0].name).toBe('prose');
  });
});
