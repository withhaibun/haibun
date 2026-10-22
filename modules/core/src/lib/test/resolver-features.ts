import { TExpandedLine, TExpandedFeature } from "../actuality/domains/actuality.js";

import { featureSplit, withName } from "../domains/features.js";

type TProtoFeature = { base?: string; path: string; content: string }[];

/** The base of a feature a test states without one. */
export const TEST_BASE = "test_base";
export const asFeatures = (w: TProtoFeature) => w.map((i) => withName(i.base || TEST_BASE, i.path, i.content));

export const asExpandedFeatures = (w: { base?: string; path: string; content: string }[]): TExpandedFeature[] =>
	asFeatures(w).map((i) => {
		const expanded: TExpandedLine[] = featureSplit(i.content).map((a, idx) => ({ line: a, lineNumber: idx + 1, feature: i }));
		const { content: _content, ...feature } = i;
		return { ...feature, expanded };
	});
