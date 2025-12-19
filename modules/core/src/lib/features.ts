import { TExpandedFeature, TExpandedLine, TFeature, TFeatures } from './defs.js';
import { getActionable } from './util/index.js';
import { TEST_BASE } from '../schema/protocol.js';

export async function expand({ features, backgrounds }: { features: TFeatures, backgrounds: TFeatures }): Promise<TExpandedFeature[]> {
	const expandedFeatures = await expandFeatures(features, backgrounds);
	return expandedFeatures;
}
// Expand backgrounds by prepending 'upper' features to 'lower' features
// biome-ignore lint/suspicious/useAwait: it's nice to be able to .catch this inline
export async function expandFeatures(features: TFeature[], backgrounds: TFeature[]): Promise<TExpandedFeature[]> {
	const expandeds: TExpandedFeature[] = [];

	for (const feature of features) {
		const expanded = expandIncluded(feature as TFeature, backgrounds);
		const ex: TExpandedFeature = { path: feature.path, base: feature.base, name: feature.name, expanded };
		expandeds.push(ex);
	}

	return Promise.resolve(expandeds);
}

function expandIncluded(feature: TFeature, backgrounds: TFeatures) {
	const lines: TExpandedLine[] = [];
	const split = featureSplit(feature.content);
	for (let i = 0; i < split.length; i++) {
		lines.push(...expandLine(split[i], i + 1, backgrounds, feature));
	}

	return lines;
}

export function asFeatureLine(line: string, lineNumber: number | undefined, feature: TFeature): TExpandedLine {
	return { line, lineNumber, feature };
}

export function expandLine(l: string, lineNumber: number | undefined, backgrounds: TFeatures, feature: TFeature): TExpandedLine[] {
	const lines: TExpandedLine[] = [];
	if (l.startsWith('Backgrounds:')) {
		const includes = doIncludes(l.replace('Backgrounds:', '').trim(), backgrounds);
		lines.push(...includes);
	} else {
		const nl = asFeatureLine(l, lineNumber, feature);
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
			throw Error(`can't find single "${l}.feature" from ${backgrounds?.map((b) => b.path).join(', ')}`);
		}
		const origin = bg[0];
		const bgLines = featureSplit(origin.content);
		for (let i = 0; i < bgLines.length; i++) {
			const bddLineNumber = i + 1;
			// For kireji files, translate BDD line number to step index (+1 for 1-indexed lines)
			// This gives an approximate TypeScript line number
			let lineNumber = bddLineNumber;
			if (origin.kirejiLineMap) {
				const stepIndex = origin.kirejiLineMap.get(bddLineNumber);
				if (stepIndex !== undefined) {
					// Use step index + offset as approximate line (kireji steps often start around line 5-10)
					lineNumber = stepIndex + 5; // Approximate offset for imports/exports in .feature.ts
				}
			}
			ret.push(asFeatureLine(bgLines[i], lineNumber, origin));
		}
	}
	return ret;
}

export function findFeatures(name: string, backgrounds: TFeatures, type = 'feature'): TFeatures {
	const ftype = findFeaturesOfType(backgrounds, type);
	// Match both .feature and .feature.ts extensions
	return ftype.filter((f) =>
		f.path.endsWith(`/${name}.${fileTypeToExt(type)}`) ||
		f.path.endsWith(`/${name}.feature.ts`)
	);
}

export function findFeaturesOfType(backgrounds: TFeatures, type = 'feature'): TFeatures {
	// Match both .feature and .feature.ts files
	return backgrounds.filter((f) =>
		f.path.endsWith(`.${fileTypeToExt(type)}`) ||
		f.path.endsWith('.feature.ts')
	);
}

const fileTypeToExt = (type: string) => (type === 'feature' ? 'feature' : `${type}.feature`);

export const featureSplit = (content: string) =>
	content
		.split('\n')
		.map((a) => a.trim());

export function withNameType(base, path: string, content: string, kirejiLineMap?: Map<number, number>) {
	const s = path.split('.');
	const name = s[0];
	const type = s.length === 3 ? s[1] : 'feature';
	return { path, base, name, type, content, kirejiLineMap };
}
