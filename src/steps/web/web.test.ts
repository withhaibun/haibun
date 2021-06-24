import { Resolver } from '../..//lib/Resolver';
import { TNotOkStepActionResult, TVStep } from '../../lib/defs';
import { Executor } from '../../lib/Executor';
import Logger, { LOGGER_NONE } from '../../lib/Logger';
import { getSteppers } from '../../lib/util';

describe('web', () => {
  it('sets up steps', async () => {
    const steppers = await getSteppers({steppers: ['web'], logger: new Logger(LOGGER_NONE), runtime: {}, shared: {}});
    expect(Object.keys(steppers[0].steps).length > 0).toBe(true);
    expect(Object.values(steppers[0].steps).every(s => !!s.action)).toBe(true);
  });
  it('sets browser type and device', async () => {
    const logger = new Logger(LOGGER_NONE);
    const steppers = await getSteppers({ steppers: ['web'], shared: {}, logger });
    const resolver = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const test = 'using firefox.Pixel 5 browser';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    await Executor.doFeatureStep(tvstep, logger);
    expect((steppers[0] as any).bf.browserType.name()).toBe('firefox');
    expect((steppers[0] as any).bf.device).toBe('Pixel 5');
  });
  it('fails setting browser type and device', async () => {
    const logger = new Logger(LOGGER_NONE);
    const steppers = await getSteppers({ steppers: ['web'], shared: {}, logger });
    const resolver = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const test = 'using nonexistant browser';
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    const result = await Executor.doFeatureStep(tvstep, logger);
    expect(result.actionResults[0].ok).toBe(false);
  });
});
