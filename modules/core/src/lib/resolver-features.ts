import { TExpandedLine, TExpandedFeature, TEST_BASE } from './defs.js';
import { TAnyFixme } from './fixme.js';
import { featureSplit, withNameType } from './features.js';

export type TProtoFeature = { base?: string; path: string; content: string; }[]

export const asFeatures = (w: TProtoFeature) => w.map((i) => withNameType(i.base || TEST_BASE, i.path, i.content));

// FIXME can't really do this without reproducing resolve
export const asExpandedFeatures = (w: { base?: string; path: string; content: string; }[]): TExpandedFeature[] => asFeatures(w).map((i) => {
	const expanded: TExpandedLine[] = featureSplit(i.content).map((a) => ({ line: a, feature: i }));
	const a: TAnyFixme = { ...i, expanded };
	delete a.content;
	// a.featureLine = asFeatureLine()
	return a;
});
