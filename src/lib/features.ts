import { TFeature, TPaths } from './defs';

export function getSteps(value: string) {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => !s.startsWith('#') && s.length);
}

// Expand backgrounds by prepending 'upper' features to 'lower' features
export async function expandBackgrounds(paths: TPaths, before = '') {
  const expanded: TPaths = {};
  const features = [];
  const nodes = [];
  for (const [path, featureOrNode] of Object.entries(paths)) {
    if (featureOrNode.feature) {
      features.push({ path, feature: featureOrNode });
    } else {
      nodes.push({ path, node: featureOrNode });
    }
  }

  for (const { path, feature } of features) {
    expanded[path] = { feature: `${before}${feature.feature}` };
    before += feature.feature;
  }
  for (const { path, node } of nodes) {
    expanded[path] = await expandBackgrounds(node as TPaths, before ? `${before}\n` : '');
  }
  return expanded;
}

export async function expandFeatures(paths: TPaths, backgrounds: TPaths) {
  const expanded: TPaths = {};

  const features = [];
  const nodes = [];

  if (typeof paths === 'string') {
  }

  for (const [path, featureOrNode] of Object.entries(paths)) {
    if (featureOrNode.feature) {
      features.push({ path, feature: featureOrNode });
    } else if (typeof featureOrNode === 'object') {
      nodes.push({ path, node: featureOrNode });
    } else {
      throw Error(`wrong structure ${paths}`);
    }

    for (const { path, feature } of features) {
      expanded[path] = await expandFeature(feature as TFeature, backgrounds);
    }
    for (const { path, node } of nodes) {
      expanded[path] = await expandFeatures(node as TPaths, backgrounds);
    }
  }
  return expanded;
}

async function expandFeature(feature: TFeature, backgrounds: TPaths) {
  const lines = feature.feature
    .split('\n')
    .map((l) => {
      if (l.match(' includes? ')) {
        const toFind = l.replace(/.* includes? /, '');
        const bg = findFeature(toFind, backgrounds);
        return bg?.feature || l;
      }
      return l;
    })
    .join('\n');

  return { feature: lines };
}

export function findFeature(name: string, features: TPaths): TFeature | undefined {
  for (const [path, featureOrNode] of Object.entries(features)) {
    if (featureOrNode.feature) {
      if (path === name) {
        return featureOrNode as TFeature;
      }
    } else {
      return findFeature(name, featureOrNode as TPaths);
    }
  }
  return undefined;
}
