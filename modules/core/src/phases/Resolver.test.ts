import { IStepper, OK, TFeatures, TFileTypeDomain, TResolvedFeature } from '../lib/defs';
import { getDefaultWorld } from '../lib/util';
import { Resolver } from './Resolver';

describe('validate map steps', () => {
  const gwtaDomainType = 'for {what: mytype}';
  const gwtaDomainTypeMultiple = 'has {what: mytype} {also: mytype}';
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
        gwta: gwtaDomainType,
        action: async () => OK,
      },
      gwtaDomainTypeMultiple: {
        gwta: gwtaDomainTypeMultiple,
        action: async () => OK,
      },
    };
  }

  const backgrounds: TFeatures = [
    { path: 'r1/available.mytype.feature', feature: 'typevalue' },
    { path: 'r1/something.mytype.feature', feature: 'typevalue2' },
  ];
  const steppers: IStepper[] = [new TestStepper()];
  const getResolver = () =>
    new Resolver(steppers, '', {
      ...getDefaultWorld().world,
      domains: [{ name: 'mytype', fileType: 'mytype', is: 'string', module: 'test', backgrounds, validate: (content: string) => undefined }],
    });
  describe('exact', () => {
    test('exact', async () => {
      const features = [{ path: 'l1', feature: `exact1` }];
      const res = await getResolver().resolveSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named).toBeUndefined();
    });
  });
  describe('match', () => {
    test('match', async () => {
      const features = [{ path: 'l1', feature: `match1` }];
      const res = await getResolver().resolveSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named).toEqual({ num: '1' });
    });
  });
  describe('gwta regex', () => {
    test('gwta', async () => {
      const features = [{ path: 'l1', feature: `gwta2\nGiven I'm gwta3\nWhen I am gwta4\nGwta5\nThen the gwta6` }];
      const res = await getResolver().resolveSteps(features);
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
      const features = [{ path: 'l1', feature: 'is "string"' }];
      const res = await getResolver().resolveSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named?.q_0).toEqual('string');
    });
    test('gets uri', async () => {
      const features = [{ path: 'l1', feature: 'is http://url' }];
      const res = await getResolver().resolveSteps(features);
      const { vsteps } = res[0] as TResolvedFeature;
      expect(vsteps[0].actions[0].named?.t_0).toEqual('http://url');
    });
  });
  describe('gwta interpolated with domain types', () => {
    test('throws for missing', async () => {
      const feature = 'for missing';
      const features = [{ path: 'l1', feature }];
      expect(async () => await getResolver().resolveSteps(features)).rejects.toThrow(
        Resolver.getNoFileTypeInclusionError(Resolver.getPrelude('l1', gwtaDomainType, feature), 'mytype', 'missing')
      );
    });
    test('includes background domain type', async () => {
      const features = [{ path: 'l1', feature: 'for available' }];
      const res = await getResolver().resolveSteps(features);
      expect(res.length).toBe(1);
    });
    test('includes multiple background domain type', async () => {
      const features = [{ path: 'l1', feature: 'has available something' }];
      const res = await getResolver().resolveSteps(features);
      expect(res.length).toBe(1);
    });
    test('includes multiple background domain type with missing', async () => {
      const feature = 'has available missing';
      const features = [{ path: 'l1', feature }];
      expect(async () => await getResolver().resolveSteps(features)).rejects.toThrow(
        Resolver.getNoFileTypeInclusionError(Resolver.getPrelude('l1', gwtaDomainTypeMultiple, feature), 'mytype', 'missing')
      );
      
    });
    test('includes background domain fails type validation', async () => {
      const feature = 'for available';
      const features = [{ path: 'l1', feature }];
      const resolver = getResolver();
      (<TFileTypeDomain>resolver.world.domains[0]).validate = (content: string) => 'failed';
      expect(async () => resolver.resolveSteps(features)).rejects.toThrow(Resolver.getTypeValidationError(Resolver.getPrelude('l1', gwtaDomainType, feature), 'mytype', 'available', 'failed'));
    });
    test('includes background domain fails multiple backgrounds', async () => {
      const feature = 'for available';
      const features = [{ path: 'l1', feature }];
      const resolver = getResolver();
      resolver.world.domains[0].backgrounds = [...backgrounds, { path: 'r1/available.mytype.feature', feature: 'typevalue3' }];
      expect(async () => resolver.resolveSteps(features)).rejects.toThrow(Resolver.getMoreThanOneInclusionError(Resolver.getPrelude('l1', gwtaDomainType, feature), 'mytype', 'available'));
    });
  });
});
