import Logger, { LOGGER_NONE } from '../../lib/Logger';
import { TShared } from '../../lib/defs';
import { getSteppers } from '../../lib/util';

describe('vars', () => {
  it('assigns', async () => {
    const steppers = await getSteppers({steppers: ['web'], logger: new Logger(LOGGER_NONE), runtime: {}, shared: {}});
    expect(Object.keys(steppers[0].steps).length > 0).toBe(true);
    expect(Object.values(steppers[0].steps).every(s => !!s.action)).toBe(true);
  });
});
