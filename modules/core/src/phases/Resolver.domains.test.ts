import { DomainContext, WorldContext } from '../lib/contexts';
import { IHasDomains, IStepper, OK, TFeatures, TFileTypeDomain } from '../lib/defs';
import { withNameType } from '../lib/features';
import { asExpandedFeatures } from '../lib/test/lib';
import { Resolver } from './Resolver';

describe('validate map steps', () => {
  test('placeholder', () => {
    expect(true).toBeTruthy();
  })
/*
  const gwtaDomainType = 'for {what: mytype}';
  const gwtaDomainTypeMultiple = 'has {what: mytype} {also: mytype}';
  class TestStepper implements IStepper, IHasDomains {
    domains: any[] = [];
    locator = (name: string) => name;
    steps = {
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

  const backgrounds: TFeatures = [withNameType('r1/available.mytype.feature', 'typevalue'), withNameType('r1/something.mytype.feature', 'typevalue2')];
  const steppers: IStepper[] = [new TestStepper()];
  const getResolver = () =>
    new Resolver(steppers, '', {
      ...getDefaultWorld().world,
      domains: [{ name: 'mytype', fileType: 'mytype', is: 'string', module: steppers[], shared: new DomainContext('test resolver.domains'), validate: (content: string) => undefined }],
    });

  // FIXME these tests depend on checkRequiredType
  xdescribe('gwta interpolated with domain types', () => {
    test('throws for missing', async () => {
      const feature = 'for missing';
      const features = asExpandedFeatures([withNameType('l1', feature)]);
      expect(async () => await getResolver().resolveSteps(features)).rejects.toThrow(
        Resolver.getNoFileTypeInclusionError(Resolver.getPrelude('l1', gwtaDomainType, feature), 'mytype', 'missing')
      );
    });
    test('includes background domain type', async () => {
      const features = asExpandedFeatures([withNameType('l1', 'for available')]);
      const res = await getResolver().resolveSteps(features);
      expect(res.length).toBe(1);
    });
    test('includes multiple background domain type', async () => {
      const features = asExpandedFeatures([withNameType('l1', 'has available something')]);
      const res = await getResolver().resolveSteps(features);
      expect(res.length).toBe(1);
    });
    test('includes multiple background domain type with missing', async () => {
      const feature = 'has available missing';
      const features = asExpandedFeatures([withNameType('l1', feature)]);
      expect(async () => await getResolver().resolveSteps(features)).rejects.toThrow(
        Resolver.getNoFileTypeInclusionError(Resolver.getPrelude('l1', gwtaDomainTypeMultiple, feature), 'mytype', 'missing')
      );
    });
    test('includes background domain fails type validation', async () => {
      const feature = 'for available';
      const features = asExpandedFeatures([withNameType('l1', feature)]);
      const resolver = getResolver();
      (<TFileTypeDomain>resolver.world.domains[0]).validate = (content: string) => 'failed';
      expect(async () => resolver.resolveSteps(features)).rejects.toThrow(Resolver.getTypeValidationError(Resolver.getPrelude('l1', gwtaDomainType, feature), 'mytype', 'available', 'failed'));
    });
    test('includes background domain fails multiple backgrounds', async () => {
      const feature = 'for available';
      const features = asExpandedFeatures([withNameType('l1', feature)]);
      const resolver = getResolver();
      expect(async () => resolver.resolveSteps(features)).rejects.toThrow(Resolver.getMoreThanOneInclusionError(Resolver.getPrelude('l1', gwtaDomainType, feature), 'mytype', 'available'));
    });
  });
*/
});
