import { IStepper, ok, TResolvedFeature } from './defs';
import Logger, { LOGGER_NONE } from './Logger';
import { Resolver } from './Resolver';

class TestStepper implements IStepper {
  steps = {
    line1: {
      exact: 'line1',
      action: async () => ok,
    },
    line2: {
      match: /line(?<num>2)/,
      action: async () => ok,
    },
  };
}
describe('validate map steps', () => {
  test('vsteps', async () => {
    const steppers: IStepper[] = [new TestStepper()];
    const val = new Resolver(steppers, {}, new Logger(LOGGER_NONE));
    const features = [{ path: 'l1', feature: `line1\nline2` }];
    const res = await val.resolveSteps(features);
    const { vsteps } = res[0] as TResolvedFeature;

    expect(vsteps).toBeDefined();
    expect(vsteps[0].actions[0].named).toBeUndefined();
    expect(vsteps[1].actions[0].named).toEqual({ num: '2' });
  });
});
