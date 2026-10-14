/**
 * The ports of actuality: the clock that times its events and its records, and the source of the features it executes.
 */
import type { TRunPolicyConfig } from "../../run-policy/run-policy-types.js";
import type { TFeaturesBackgrounds } from "./domains/execution.js";
import type { TBase } from "./domains/world.js";

/** The time of an event or a record, in milliseconds since the epoch. */
export type TClock = { now: () => number };

/** How a feature source refuses a base that doesn't hold a feature or a background. */
export const BASE_WITHOUT_FEATURES = "doesn't hold a feature or a background";

/** The features and the backgrounds of a set of bases. A feature filter selects the features, and a run policy selects
 *  the directories a run may read; the backgrounds are read whatever the filter. */
export type TFeatureSource = { collect: (bases: TBase, featureFilter: string[] | undefined, policyConfig: TRunPolicyConfig | undefined) => Promise<TFeaturesBackgrounds> };
