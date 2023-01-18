import { AStepper, OK, TExpandedFeature, TResolvedFeature } from '../lib/defs.js';
import { asExpandedFeatures, getDefaultWorld } from '../lib/test/lib.js';
import { createSteppers } from '../lib/util/index.js';
import { Resolver } from './Resolver.js';

describe('validate map steps', () => {
  class TestStepper extends AStepper {
    steps = {
      exact: {
        exact: 'exact1',
        action: async () => OK,
      },
      match: {
        match: /match(?<num>1)/,
        action: async () => OK,
      },
      gwta: {
        gwta: 'gwta(?<num>.)',
        action: async () => OK,
      },
      gwtaInterpolated: {
        gwta: 'is {what}',
        action: async () => OK,
      },
    };
  }

  const getResolvedSteps = async (features: TExpandedFeature[]) => {
    const steppers = await createSteppers([TestStepper]);
    const resolver = new Resolver(steppers, '', {
      ...getDefaultWorld(0).world,
    });
    return await resolver.resolveSteps(features);
  }
  describe('exact', () => {
    test('exact', async () => {
      const features = asExpandedFeatures([{ path: 'l1', content: `exact1` }]);

      const res = await getResolvedSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named).toBeUndefined();
    });
  });
  describe('match', () => {
    test('match', async () => {
      const features = asExpandedFeatures([{ path: 'l1', content: `match1` }]);
      const res = await getResolvedSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named).toEqual({ num: '1' });
    });
  });
  describe('gwta regex', () => {
    test('gwta', async () => {
      const features = asExpandedFeatures([{ path: 'l1', content: `gwta2\nGiven I'm gwta3\nWhen I am gwta4\nGwta5\nThen the gwta6` }]);
      const res = await getResolvedSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named).toEqual({ num: '2' });
      expect(vsteps[1].actions[0].named).toEqual({ num: '3' });
      expect(vsteps[2].actions[0].named).toEqual({ num: '4' });
      expect(vsteps[3].actions[0].named).toEqual({ num: '5' });
      expect(vsteps[4].actions[0].named).toEqual({ num: '6' });
    });
  });
  describe('gwta interpolated', () => {
    test('gets quoted', async () => {
      const features = asExpandedFeatures([{ path: 'l1', content: 'is "string"' }]);
      const res = await getResolvedSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named?.q_0).toEqual('string');
    });
    test('gets uri', async () => {
      const features = asExpandedFeatures([{ path: 'l1', content: 'is http://url' }]);
      const res = await getResolvedSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named?.t_0).toEqual('http://url');
    });
  });
});
