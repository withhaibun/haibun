import { TShared, TVStep } from '../lib/defs';
import { Investigator } from '../lib/investigator/Investigator';
import { Resolver } from '../lib/Resolver';
import { getSteppers } from '../lib/util';

describe('vars', () => {
  it('assigns', async () => {
    const shared: TShared = {};
    const steppers = await getSteppers(['vars'], shared);
    const resolver = new Resolver(steppers, {});
    const actions = resolver.findSteps('When x is y');
    const tvstep: TVStep = {
      in: 'run vars',
      seq: 0,
      actions,
    };

    const res = await Investigator.doStep(tvstep);
    expect(shared.x).toBe('y');
  });
});
