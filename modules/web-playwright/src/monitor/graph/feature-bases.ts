import { TResolvedFeature } from "@haibun/core/build/lib/defs.js";

export function getBaseLocations(resolvedFeatures) {
  // Collect all unique base locations from features
  const baseLocations = new Set();
  resolvedFeatures.forEach(f => {
    if (f.base && typeof f.base === 'string' && f.base.trim() !== '') {
      baseLocations.add(f.base);
    }
  });
  return baseLocations;
}

export function getBackgroundFeatures(resolvedFeatures: TResolvedFeature[]) {
  const backgroundPaths = new Set<string>();
  resolvedFeatures.forEach(f => {
    const steps = f.featureSteps ?? [];
    steps.forEach(step => {
      if (step.path && step.path !== f.path) {
        backgroundPaths.add(step.path);
      }
    });
  });
  return backgroundPaths;
}

export function getBaseFeatures(resolvedFeatures) {
  // Map of base path to the resolved feature object
  const bases = new Map();
  resolvedFeatures.forEach(f => {
    if (f.base && typeof f.base === 'string' && f.base.trim() !== '') {
      const baseFeature = resolvedFeatures.find(rf => rf.path === f.base);
      if (baseFeature) {
        bases.set(f.base, baseFeature);
      }
    }
  });
  return bases;
}
