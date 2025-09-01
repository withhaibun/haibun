import { TExpandedFeature, TExpandedLine, TFeature, TFeatures } from './defs.js';
import { getActionable } from './util/index.js';

export async function expand({ features, backgrounds }: { features: TFeatures, backgrounds: TFeatures }): Promise<TExpandedFeature[]> {
	const expandedFeatures = await expandFeatures(features, backgrounds);
	return expandedFeatures;
}
// Expand backgrounds by prepending 'upper' features to 'lower' features
export async function expandFeatures(features: TFeature[], backgrounds: TFeature[]): Promise<TExpandedFeature[]> {
	const expandeds: TExpandedFeature[] = [];

	for (const feature of features) {
		const expanded = await expandIncluded(feature as TFeature, backgrounds);
		const ex: TExpandedFeature = { path: feature.path, base: feature.base, name: feature.name, expanded };
		expandeds.push(ex);
	}

	return expandeds;
}

export async function expandIncluded(feature: TFeature, backgrounds: TFeatures) {
	const lines: TExpandedLine[] = [];
	const split = featureSplit(feature.content);
	for (const l of split) {
		lines.push(...expandLine(l, backgrounds, feature));
	}

	return Promise.resolve(lines);
}

export const asFeatureLine = (line: string, feature: TFeature): TExpandedLine => ({ line, feature });

export function expandLine(l: string, backgrounds: TFeatures, feature: TFeature) {
	const lines: TExpandedLine[] = [];
	const actionable = getActionable(l);

	if (actionable.match(/^Backgrounds: .*$/i)) {
		const includes = doIncludes(l.replace(/^Backgrounds: /i, ''), backgrounds);
		lines.push(...includes);
	} else {
		const nl = asFeatureLine(l, feature);
		lines.push(nl);
	}
	return lines;
}

function doIncludes(input: string, backgrounds: TFeatures) {
	const includes = input.split(',').map((a) => a.trim());
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

export function withNameType(base, path: string, content: string) {
	const s = path.split('.');
	const name = s[0];
	const type = s.length === 3 ? s[1] : 'feature';
	return { path, base, name, type, content };
}
