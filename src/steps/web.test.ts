import { captureRejectionSymbol } from 'events';
import { TShared, TVStep } from '../lib/defs';
import { Investigator } from '../lib/investigator/Investigator';
import { Resolver } from '../lib/Resolver';
import { getSteppers } from '../lib/util';

describe('vars', () => {
  it('assigns', async () => {
    const shared: TShared = {};
    const steppers = await getSteppers(['web'], shared);
    expect(Object.keys(steppers[0].steps).length > 0).toBe(true);
    expect(Object.values(steppers[0].steps).every(s => !!s.action)).toBe(true);
  });
});
