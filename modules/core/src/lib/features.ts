import { TExpandedFeature, TExpandedLine, TFeature, TFeatures } from './defs.js';
import { getActionable } from './util/index.js';

export async function expand({ backgrounds, features }: { backgrounds: TFeatures, features: TFeatures }): Promise<TExpandedFeature[]> {
	const expandedBackgrounds = await expandBackgrounds(backgrounds);
	const expandedFeatures = await expandFeatures(features, expandedBackgrounds);
	return expandedFeatures;
}

// Expand backgrounds by prepending 'upper' features to 'lower' features
export async function expandBackgrounds(features: TFeatures) {
	const expanded: TFeatures = [];
	for (const { base, path, content: feature } of features) {
		let res = feature;
		let r = findUpper(path, features);
		while (r.upper.length > 0 && r.rem !== '/') {
			r = findUpper(r.rem, features);

			for (const s of r.upper) {
				res = s.content + '\n' + res;
			}
		}
		expanded.push(withNameType(base, path, res));
	}
	return Promise.resolve(expanded);
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

export async function expandFeatures(features: TFeature[], backgrounds: TFeature[]): Promise<TExpandedFeature[]> {
	const expandeds: TExpandedFeature[] = [];

	for (const feature of features) {
		const expanded = await expandIncluded(feature as TFeature, backgrounds);
		const ex: TExpandedFeature = { path: feature.path, base: feature.base, name: feature.name, expanded };
		expandeds.push(ex);
	}

	return expandeds;
}

async function expandIncluded(feature: TFeature, backgrounds: TFeatures) {
	let lines: TExpandedLine[] = [];
	const split = featureSplit(feature.content);
	for (const l of split) {
		const actionable = getActionable(l);

		if (actionable.match(/^Backgrounds: .*$/i)) {
			lines = lines.concat(doIncludes(l, backgrounds));
		} else {
			const nl = asFeatureLine(l, feature);
			lines.push(nl);
		}
	}

	return Promise.resolve(lines);
}

export function withNameType(base, path: string, content: string) {
	const s = path.split('.');
	const name = s[0];
	const type = s.length === 3 ? s[1] : 'feature';
	return { path, base, name, type, content };
}

export const asFeatureLine = (line: string, feature: TFeature): TExpandedLine => ({ line, feature });

function doIncludes(input: string, backgrounds: TFeatures) {
	const includes = input.replace(/^.*?: /, '').split(',').map((a) => a.trim());
	const ret: TExpandedLine[] = [];
	for (const l of includes) {
		const bg = findFeatures(l, backgrounds);
		if (bg.length !== 1) {
			throw Error(`can't find single "${l}.feature" from ${backgrounds.map((b) => b.path).join(', ')}`);
		}
		const origin = bg[0];
		for (const l of featureSplit(origin.content)) {
			ret.push(asFeatureLine(l, origin));
		}
	}
	return ret;
}

export function findFeatures(name: string, backgrounds: TFeatures, type = 'feature'): TFeatures {
	const ftype = findFeaturesOfType(backgrounds, type);
	return ftype.filter((f) => f.path.endsWith(`/${name}.${fileTypeToExt(type)}`));
}

export function findFeaturesOfType(backgrounds: TFeatures, type = 'feature'): TFeatures {
	return backgrounds.filter((f) => f.path.endsWith(`.${fileTypeToExt(type)}`));
}

const fileTypeToExt = (type: string) => (type === 'feature' ? 'feature' : `${type}.feature`);

export const featureSplit = (content: string) =>
	content
		.trim()
		.split('\n')
		.map((a) => a.trim())
		.filter((a) => a.length > 0);
