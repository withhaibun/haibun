import nodeFS from 'fs';
import { TFeature } from '../lib/defs.js';
import { withNameType } from '../lib/features.js';
import { TFileSystem } from '../lib/util/index.js';

export type TFeaturesBackgrounds = {
  features: TFeature[];
  backgrounds: TFeature[];
};

export function getFeaturesAndBackgrounds(base: string, featureFilter: string[], fs: TFileSystem = nodeFS): TFeaturesBackgrounds {
  const ret = { features: [], backgrounds: [] };
  for (const abase of base.split(',').map(b => b.trim())) {
    const aret = { features: [], backgrounds: [] };
    if (fs.existsSync(`${abase}/features`)) {
      aret.features = aret.features.concat(debase(abase, recurse(`${abase}/features`, 'feature', featureFilter, fs)));
    }
    if (fs.existsSync(`${abase}/backgrounds`)) {
      aret.backgrounds = aret.backgrounds.concat(debase(abase, recurse(`${abase}/backgrounds`, 'feature', [], fs)));
    }
    if (aret.features.length < 1 && aret.backgrounds.length < 1) {
      throw Error(`no features or backgrounds found from "${abase}"`);
    }
    ret.features = ret.features.concat(aret.features);
    ret.backgrounds = ret.backgrounds.concat(aret.backgrounds);
  }
  if (ret.features.length < 1) {
    throw Error(`no features or backgrounds found from "${base}"`);
  }
  return ret;
}

export function recurse(dir: string, type: string, featureFilter: string[] | undefined = undefined, fs: TFileSystem = nodeFS): TFeature[] {
  const files = fs.readdirSync(dir);
  let all: TFeature[] = [];
  for (const file of files) {
    const here = `${dir}/${file}`;
    if (fs.statSync(here).isDirectory()) {
      all = all.concat(recurse(here, type, featureFilter, fs));
    } else if (shouldProcess(here, type, featureFilter)) {
      all.push(withNameType(here, fs.readFileSync(here, 'utf-8')));
    }
  }
  return all;
}

export function shouldProcess(file: string, type: undefined | string, featureFilter: string[] | undefined) {
  const isType = !type || file.endsWith(`.${type}`);
  const matchesFilter = featureFilter === undefined || featureFilter.length < 1 ? true : !!featureFilter.find((f) => file.replace(/\/.*?\/([^.*?/])/, '$1').match(f));

  return isType && matchesFilter;
}

export function debase(base: string, features: TFeature[]) {
  return features.map((f) => ({ ...f, path: f.path.replace(base, '') }));
}
