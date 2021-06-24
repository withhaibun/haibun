import Logger, { LOGGER_NONE } from '../lib/Logger';
import { TShared, TVStep } from '../lib/defs';
import { Executor } from '../lib/Executor';
import { Resolver } from '../lib/Resolver';
import { getSteppers } from '../lib/util';
import { didNotOverwrite } from './vars';

describe('vars', () => {
  it('assigns', async () => {
    const shared: TShared = {};
    const logger = new Logger(LOGGER_NONE);
    const steppers = await getSteppers({ steppers: ['vars'], shared, logger });
    const resolver = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const test = 'Given I set x to y';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    await Executor.doFeatureStep(tvstep, logger);
    expect(shared.x).toBe('y');
  });
  it('assigns empty', async () => {
    const shared: TShared = {};
    const logger = new Logger(LOGGER_NONE);
    const steppers = await getSteppers({ steppers: ['vars'], shared, logger });
    const resolver = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const test = 'Given I set x to y';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    await Executor.doFeatureStep(tvstep, logger);
    expect(shared.x).toBe('y');
  });
  it('empty does not overwrite', async () => {
    const shared: TShared = { x: 'notY' };
    const logger = new Logger(LOGGER_NONE);
    const steppers = await getSteppers({ steppers: ['vars'], shared, logger });
    const resolver = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const test = 'Given I set empty x to y';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    const res = await Executor.doFeatureStep(tvstep, logger);
    expect(shared.x).toBe('notY');
    expect(res.actionResults[0].details).toEqual(didNotOverwrite('x', 'notY', 'y'));
  });
});
