import Logger, { LOGGER_NONE } from '../lib/Logger';
import { TShared, TVStep } from '../lib/defs';
import { Investigator } from '../lib/investigator/Investigator';
import { Resolver } from '../lib/Resolver';
import { getSteppers } from '../lib/util';

describe('vars', () => {
  it('assigns', async () => {
    const shared: TShared = {};
    const steppers = await getSteppers({steppers: ['vars'], shared, logger: new Logger(LOGGER_NONE)});
    const resolver = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const actions = resolver.findSteps('Given x is y');
    const tvstep: TVStep = {
      in: 'run vars',
      seq: 0,
      actions,
    };

    const res = await Investigator.doStep(tvstep);
    expect(shared.x).toBe('y');
  });
});