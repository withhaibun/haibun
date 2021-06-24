import Logger, { LOGGER_NONE } from '../lib/Logger';
import { TShared, TVStep } from '../lib/defs';
import { Executor } from '../lib/Executor';
import { Resolver } from '../lib/Resolver';
import { getSteppers } from '../lib/util';

describe('haibun', () => {
  it('finds prose', async () => {
    const shared: TShared = {};
    const logger = new Logger(LOGGER_NONE);
    const steppers = await getSteppers({ steppers: ['haibun'], shared, logger });
    const resolver = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const test = 'A sentence.';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    const res = await Executor.doFeatureStep(tvstep, logger);
    expect(res.ok).toBe(true);
    expect(res.actionResults[0].name).toBe('prose');
  });
});
