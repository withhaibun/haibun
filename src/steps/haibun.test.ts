import Logger, { LOGGER_NONE } from '../lib/Logger';
import { TShared, TVStep } from '../lib/defs';
import { Investigator } from '../lib/investigator/Investigator';
import { Resolver } from '../lib/Resolver';
import { getSteppers } from '../lib/util';

describe('vars', () => {
  it('assigns', async () => {
    const shared: TShared = {};
    const logger = new Logger(LOGGER_NONE);
    const steppers = await getSteppers({steppers: ['haibun'], shared, logger});
    const resolver = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const actions = resolver.findSteps('A sentence.');
    const tvstep: TVStep = {
      in: 'run vars',
      seq: 0,
      actions,
    };

    const res = await Investigator.doFeatureStep(tvstep, logger);
    expect(res.ok).toBe(true);
    expect(res.actionResults[0].name).toBe('prose');
  });
});