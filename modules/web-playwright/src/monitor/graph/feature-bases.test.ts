import { describe, it, expect } from 'vitest';
import { getBaseFeatures } from './feature-bases.js';
import { asFeatures } from '@haibun/core/build/lib/resolver-features.js';

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
