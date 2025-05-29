import { describe, it, expect } from 'vitest';
import { getBaseLocations } from './feature-bases.js';

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
