import { describe, it, expect } from 'vitest';
import { getBaseFeatures, getBaseLocations, getBackgroundFeatures } from './feature-bases.js';
import { asFeatures } from '@haibun/core/lib/resolver-features.js';
import { createSteppers } from '@haibun/core/lib/util/index.js';
import { Resolver } from '@haibun/core/phases/Resolver.js';
import { expand } from '@haibun/core/lib/features.js';
import Haibun from '@haibun/core/steps/haibun.js';
import { OK } from '@haibun/core/lib/defs.js';
import { AStepper } from '@haibun/core/lib/astepper.js';

class TestStepper extends AStepper {
  steps = {
    'Background step 1': {
      exact: 'Background step 1',
      action: async () => Promise.resolve(OK),
    },
    'Feature step 1': {
      exact: 'Feature step 1',
      action: async () => Promise.resolve(OK),
    },
  };
}

describe('feature-bases utilities', () => {
  describe('getBaseFeatures', () => {
    it('returns a map of base paths to base features', () => {
      const features = asFeatures([
        { path: '/base1.feature', content: '' },
        { path: '/base2.feature', content: '' },
        { path: '/f1.feature', base: '/base1.feature', content: '' },
        { path: '/f2.feature', base: '/base2.feature', content: '' },
        { path: '/f3.feature', base: '/base1.feature', content: '' },
      ]);
      const bases = getBaseFeatures(features);
      expect(bases.size).toBe(2);
      expect(bases.get('/base1.feature').path).toBe('/base1.feature');
      expect(bases.get('/base2.feature').path).toBe('/base2.feature');
    });

    it('ignores features with missing base targets', () => {
      const features = asFeatures([
        { path: '/base1.feature', content: '' },
        { path: '/f1.feature', base: '/base1.feature', content: '' },
        { path: '/f2.feature', base: '/missing.feature', content: '' },
      ]);
      const bases = getBaseFeatures(features);
      expect(bases.size).toBe(1);
      expect(bases.get('/base1.feature').path).toBe('/base1.feature');
      expect(bases.has('/missing.feature')).toBe(false);
    });

    it('returns empty map if no features have a base', () => {
      const features = asFeatures([
        { path: '/f1.feature', content: '' },
        { path: '/f2.feature', content: '' },
      ]);
      const bases = getBaseFeatures(features);
      expect(bases.size).toBe(0);
    });
  });

  describe('getBaseLocations', () => {
    it('returns all unique base locations from features', () => {
      const features = [
        { path: '/f1', base: '/root/baseA', featureSteps: [] },
        { path: '/f2', base: '/root/baseA', featureSteps: [] },
        { path: '/f3', base: '/root/baseB', featureSteps: [] },
        { path: '/f4', featureSteps: [] },
      ];
      const bases = getBaseLocations(features);
      expect(bases.size).toBe(2);
      expect(bases.has('/root/baseA')).toBe(true);
      expect(bases.has('/root/baseB')).toBe(true);
    });

    it('returns empty set if no features have a base', () => {
      const features = [
        { path: '/f1', featureSteps: [] },
        { path: '/f2', featureSteps: [] },
      ];
      const bases = getBaseLocations(features);
      expect(bases.size).toBe(0);
    });
  });

  describe('getBackgroundFeatures', () => {
    it('extracts backgrounds from resolved features', async () => {
      const features = asFeatures([
        { path: '/f1.feature', content: 'Backgrounds: b1\nScenario: F1\nFeature step 1' },
        { path: '/f2.feature', content: 'Backgrounds: b2\nScenario: F2\nFeature step 1' },
      ]);
      const backgrounds = asFeatures([
        { path: '/b1.feature', content: 'Background step 1' },
        { path: '/b2.feature', content: 'Background step 1' },
      ]);
      const steppers = createSteppers([TestStepper, Haibun]);
      const expandedFeatures = await expand({ backgrounds, features });
      const resolver = new Resolver(steppers);
      const resolvedFeatures = await resolver.resolveStepsFromFeatures(expandedFeatures);
      const result = getBackgroundFeatures(resolvedFeatures);
      expect(new Set(result)).toEqual(new Set(['/b1.feature', '/b2.feature']));
    });
  });
});

