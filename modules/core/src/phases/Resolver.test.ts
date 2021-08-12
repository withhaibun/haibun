import { IStepper, OK, TFeatures, TResolvedFeature } from '../lib/defs';
import { getDefaultWorld } from '../lib/util';
import { Resolver } from './Resolver';

describe('validate map steps', () => {
  class TestStepper implements IStepper {
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
      gwtaDomainType: {
        gwta: 'for {what: mytype}',
        action: async () => OK,
      },
    };
  }

  const backgrounds: TFeatures = [{ path: 'r1.type', feature: 'typevalue' }];
  const steppers: IStepper[] = [new TestStepper()];
  const resolver = new Resolver(steppers, '', {
    ...getDefaultWorld().world,
    domains: [{ name: 'mytype', fileType: 'mytype', is: 'string', module: 'test', backgrounds }],
  });
  describe('exact', () => {
    test('exact', async () => {
      const features = [{ path: 'l1', feature: `exact1` }];
      const res = await resolver.resolveSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named).toBeUndefined();
    });
  });
  describe('match', () => {
    test('match', async () => {
      const features = [{ path: 'l1', feature: `match1` }];
      const res = await resolver.resolveSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named).toEqual({ num: '1' });
    });
  });
  describe('gwta regex', () => {
    test('gwta', async () => {
      const features = [{ path: 'l1', feature: `gwta2\nGiven I'm gwta3\nWhen I am gwta4\nGwta5\nThen the gwta6` }];
      const res = await resolver.resolveSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named).toEqual({ num: '2' });
      expect(vsteps[1].actions[0].named).toEqual({ num: '3' });
      expect(vsteps[2].actions[0].named).toEqual({ num: '4' });
      expect(vsteps[3].actions[0].named).toEqual({ num: '5' });
      expect(vsteps[4].actions[0].named).toEqual({ num: '6' });
    });
  });
  describe('gwta interpolated', () => {
    describe('gwta comp', () => {
      test('gets quoted', async () => {
        const features = [{ path: 'l1', feature: 'is "string"' }];
        const res = await resolver.resolveSteps(features);
        const { vsteps } = res[0] as TResolvedFeature;
        expect(vsteps[0].actions[0].named?.q_0).toEqual('string');
      });
      test('gets uri', async () => {
        const features = [{ path: 'l1', feature: 'is http://url' }];
        const res = await resolver.resolveSteps(features);
        const { vsteps } = res[0] as TResolvedFeature;
        expect(vsteps[0].actions[0].named?.t_0).toEqual('http://url');
      });
    });
  });
  describe('gwta interpolated with domain types', () => {
    describe('gwta comp with domain types', () => {
      test('throws for missing', async () => {
        const features = [{ path: 'l1', feature: 'for missing' }];
        expect(async () => await resolver.resolveSteps(features)).rejects.toThrowError();
      });
    });
  });
});
