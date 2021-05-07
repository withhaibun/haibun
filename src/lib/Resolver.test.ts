import { IStepper, ok, TVStep } from './defs';
import { Resolver } from './Resolver';

class TestStepper implements IStepper {
  steps = {
    line1: {
      match: 'line1',
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
    const val = new Resolver(steppers, {});
    const features = {
      l1: {
        feature: `line1\nline2`,
      },
    };
    const res = await val.resolveSteps(features);
    const vsteps = res.l1.vsteps as TVStep[];
    console.log(JSON.stringify(vsteps, null, 2));
    expect(vsteps).toBeDefined();
    expect(vsteps[0])
  });
});
