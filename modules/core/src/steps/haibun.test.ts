import { TVStep } from '../lib/defs';
import { Executor } from '../lib/Executor';
import { Resolver } from '../lib/Resolver';
import { getTestEnv } from '../lib/TestSteps';
import { getSteppers, getDefaultWorld } from '../lib/util';

describe('haibun', () => {
  it('finds prose', async () => {
    const { world, vstep } = await getTestEnv(['haibun'], 'A sentence.', getDefaultWorld().world);
    const res = await Executor.doFeatureStep(vstep, world);
    expect(res.ok).toBe(true);
    expect(res.actionResults[0].name).toBe('prose');
  });
});
