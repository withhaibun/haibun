/**
 * The ports of actuality: the clock that times its events and its records, the source of the features it executes, and the
 * prover that proves every step.
 */
import type { TRunPolicyConfig } from "../../run-policy/domains/run-policy.js";
import type { TFeaturesBackgrounds } from "./domains/actuality.js";
import type { TBase } from "./domains/world.js";
import type { DispatchContext } from "./pipelines/step-dispatch.js";
import type { TFeatureStep } from "../steps/domains/stepper.js";
import type { TActionResult, TStepResult } from "../domains/protocol.js";
import type { TExceeding, TPermission } from "../domains/actions.js";

/** The time of an event or a record in milliseconds since the epoch, a wait of a number of milliseconds, and a task after a
 *  number of milliseconds, which the returned function cancels. A task that doesn't hold the process lets it exit first. */
export type TClock = { now: () => number; wait: (ms: number) => Promise<void>; after: (ms: number, task: () => void, holdsProcess: boolean) => () => void };

/** How a feature source refuses a base that doesn't hold a feature or a background. */
export const BASE_WITHOUT_FEATURES = "doesn't hold a feature or a background";

/** The features and the backgrounds of a set of bases. A feature filter selects the features, and a run policy selects
 *  the directories a run may read; the backgrounds are read whatever the filter. */
export type TFeatureSource = { collect: (bases: TBase, featureFilter: string[] | undefined, policyConfig: TRunPolicyConfig | undefined) => Promise<TFeaturesBackgrounds> };

/** The logic engine's entry. Every surface proves a step through it: a feature's line, a statement a step states, and a call
 *  a transport carries. The prover evaluates the step's formal reading, dispatches each call the proof needs, writes the
 *  proof's records and returns the step's result with its verdict. It also proves a permission's containment in its bound, on
 *  which a statement under a capability and a narrowed statement rest. A stepper of the configuration supplies it. */
export type TProver = {
	prove: (ctx: DispatchContext, featureStep: TFeatureStep) => Promise<TStepResult>;
	/** Proves the statements a step states, in order, as one proof under the step's record, and returns the result of the first
	 *  that isn't proved, or of the last. `targetHostId` names the host whose steps prove them, where another host does. */
	proveStatements: (ctx: DispatchContext, parent: TFeatureStep, statements: TFeatureStep[], targetHostId?: number) => Promise<TActionResult>;
	/** Returns what `candidate` holds beyond `bound`, which is empty where the bound contains it. */
	exceeding: (candidate: TPermission, bound: TPermission) => Promise<TExceeding[]>;
};
