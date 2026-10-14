import { TExpandedLine, TExpandedFeature } from "./execution.js";

import { TEST_BASE } from "../schema/protocol.js";
import { featureSplit, withName } from "./features.js";

type TProtoFeature = { base?: string; path: string; content: string }[];

export const asFeatures = (w: TProtoFeature) => w.map((i) => withName(i.base || TEST_BASE, i.path, i.content));

export const asExpandedFeatures = (w: { base?: string; path: string; content: string }[]): TExpandedFeature[] =>
	asFeatures(w).map((i) => {
		const expanded: TExpandedLine[] = featureSplit(i.content).map((a, idx) => ({ line: a, lineNumber: idx + 1, feature: i }));
		const { content: _content, ...feature } = i;
		return { ...feature, expanded };
	});
