import nodeFS from 'fs';
import { TBase, TFeature } from '../lib/defs.js';
import { withNameType } from '../lib/features.js';
import { TFileSystem } from '../lib/util/workspace-lib.js';

export type TFeaturesBackgrounds = {
  features: TFeature[];
  backgrounds: TFeature[];
};

export function getFeaturesAndBackgrounds(bases: TBase, featureFilter: string[], fs: TFileSystem = nodeFS): TFeaturesBackgrounds {
  const ret = { features: [], backgrounds: [] };
  for (const abase of bases) {
    const ff = { feature: featureFilter };

    const rawFeaturesAndBackgrounds = { features: [], backgrounds: [] };
    for (const t of ['feature', 'background']) {
      const p = `${t}s`;
      if (fs.existsSync(`${abase}/${p}`)) {
        const more = debase(abase, recurse(abase, `/${p}`, 'feature', ff[t], fs));
        rawFeaturesAndBackgrounds[p] = rawFeaturesAndBackgrounds[p].concat(more);
      }
    }
    if (rawFeaturesAndBackgrounds.features.length < 1 && rawFeaturesAndBackgrounds.backgrounds.length < 1) {
      throw Error(`no features or backgrounds found from "${abase}"`);
    }
    ret.features = ret.features.concat(rawFeaturesAndBackgrounds.features);
    ret.backgrounds = ret.backgrounds.concat(rawFeaturesAndBackgrounds.backgrounds);
  }
  if (ret.features.length < 1) {
    throw Error(`no features found from "${bases}"`);
  }
  return ret;
}

function recurse(base: string, dir: string, type: string, featureFilter: string[] | undefined = undefined, fs: TFileSystem = nodeFS): TFeature[] {
  const files = fs.readdirSync(`${base}${dir}`);
  let all: TFeature[] = [];
  for (const file of files) {
    const here = `${base}${dir}/${file}`;
    if (fs.statSync(here).isDirectory()) {
      all = all.concat(recurse(base, `${dir}/${file}`, type, featureFilter, fs));
    } else if (shouldProcess(here, type, featureFilter)) {
      const contents = fs.readFileSync(here, 'utf-8')
      all.push(withNameType(base, here, contents));
    }
  }
  return all;
}

export function shouldProcess(file: string, type: undefined | string, featureFilter: string[] | undefined) {
  const isType = !type || file.endsWith(`.${type}`);
  const matchesFilter = (featureFilter === undefined || featureFilter.every(f => f === '')) || featureFilter.length < 1 ? true : !!featureFilter.find((f) => file.replace(/\/.*?\/([^.*?/])/, '$1').match(f));

  return isType && matchesFilter;
}

export function debase(abase: string, features: TFeature[]) {
  return features.map((f) => ({ ...f, path: f.path.replace(abase, '') }));
}
