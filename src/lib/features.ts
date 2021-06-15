import { join } from 'path/posix';
import { TFeature, TFeatures } from './defs';
import { getActionable } from './util';

export function getSteps(value: string) {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => !s.startsWith('#') && s.length);
}

// Expand backgrounds by prepending 'upper' features to 'lower' features
export async function expandBackgrounds(features: TFeatures, before = '') {
  const expanded: TFeatures = [];
  for (const { path, feature } of features) {
    let res = feature;
    let r = findUpper(path, features);
    while (r.upper.length > 0 && r.rem !== '/') {
      r = findUpper(r.rem, features);
      
      for (const s of r.upper) {
        res = s.feature + '\n' + res;
      }
    }
    expanded.push({ path, feature: res });
  }
  return expanded;
}
const upperPath = (path: string) => {
  const r = path.split('/');
  return '/' + r.slice(1, r.length - 1).join('/');
};

export function findUpper(path: string, features: TFeatures) {
  const rem = upperPath(path);
  const upper = features.filter((f) => {
    const p = upperPath(f.path);

    return p === rem;
  });
  
  return { rem, upper };
}

export async function expandFeatures(features: TFeature[], backgrounds: TFeatures) {
  const expanded: TFeature[] = [];

  for (const feature of features) {
    feature.feature = await expandIncluded(feature as TFeature, backgrounds);
    expanded.push(feature);
  }
  return expanded;
}

async function expandIncluded(feature: TFeature, backgrounds: TFeatures) {
  const lines = feature.feature
    .split('\n')
    .map((l) => {
      if (getActionable(l).match(/^Backgrounds: .*$/)) {
        return doIncludes(l, backgrounds);
      } else if (getActionable(l).match(/^Scenarios: .*$/)) {
        return doIncludes(l, backgrounds);
      }
      return l;
    })
    .join('\n');

  return lines;
}

function doIncludes(input: string, backgrounds: TFeatures) {
  const includes = input.replace(/^.*?: /, '').split(',');
  let ret = '';
  for (const l of includes) {
    const toFind = l.trim();
    const bg = findFeature(toFind, backgrounds);
    if (bg.length !== 1 ) {
      throw Error(`can't find single "${toFind}" from ${backgrounds.map((b) => b.path).join(', ')}`);
    }
    ret += `\n${bg[0].feature.trim()}\n`;
  }
  return ret;
}

export function findFeature(name: string, features: TFeatures): TFeatures {
  return features.filter(f => f.path.endsWith(`/${name}`))
}
