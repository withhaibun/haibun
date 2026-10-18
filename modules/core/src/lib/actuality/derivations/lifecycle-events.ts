/**
 * The lifecycle events of an execution's levels: the execution, a feature, a scenario and a step, each at its start and
 * its end. Each is the move the actuality machine takes and the event the stream carries, built here once.
 */
import { LifecycleEvent, STATUS, stepLevel, type TLifecycleEvent, type TStepEnd } from "../../domains/protocol.js";
import type { TFeatureStep } from "../../steps/domains/stepper.js";
import { isSecretName } from "../../steps/domains/secrets.js";
import { errorDetail } from "../../domains/util.js";
import { sanitizeObjectSecrets } from "../../domains/secret-utils.js";
import { formatSeqPath } from "../domains/seq-path.js";
import type { TLevelEnd } from "../machines/actuality.js";

type TStage = "start" | "end";
/** A level's status at a stage: running at its start, and how it ended at its end. */
type TAtStage = { stage: "start" } | { stage: "end"; status: TLevelEnd };
const statusAt = (at: TAtStage): { stage: TStage; status: typeof STATUS.running | TLevelEnd } => (at.stage === "start" ? { stage: "start", status: STATUS.running } : at);

/** The id of the execution's events, at its start and its end, as each level's events carry one id at both. */
const EXECUTION_EVENT_ID = "execution";

/** The id of a feature's events, by its number in the execution. */
export const featureEventId = (featureNum: number): string => `feat-${featureNum}`;

/** The id of a scenario's events, by its feature's number and its own. */
export const scenarioEventId = (featureNum: number, scenarioNum: number): string => `${featureEventId(featureNum)}.scen-${scenarioNum}`;

/** The execution's event at a stage. Its start states the execution's heading: the bases that hold its features. */
export const executionEvent = (at: TAtStage, timestamp: number, heading?: string): TLifecycleEvent =>
	LifecycleEvent.parse({ id: EXECUTION_EVENT_ID, timestamp, kind: "lifecycle", type: "execution", ...(heading === undefined ? {} : { in: heading }), ...statusAt(at) });

/** A feature's event at a stage. */
export const featureEvent = (featureNum: number, feature: { path: string; name: string }, at: TAtStage, timestamp: number): TLifecycleEvent =>
	LifecycleEvent.parse({ id: featureEventId(featureNum), timestamp, kind: "lifecycle", type: "feature", featurePath: feature.path, featureName: feature.name, ...statusAt(at) });

/** A scenario's event at a stage. */
export const scenarioEvent = (featureNum: number, scenarioNum: number, scenarioName: string, at: TAtStage, timestamp: number): TLifecycleEvent =>
	LifecycleEvent.parse({ id: scenarioEventId(featureNum, scenarioNum), timestamp, kind: "lifecycle", type: "scenario", scenarioName, ...statusAt(at) });

/** What a step's events state of what ran it: the stepper and its action, and the step's values. */
export type TStepCalled = { stepperName: string; actionName: string; stepValuesMap: Record<string, unknown> | undefined };

/** A step's values with each secret variable's value obscured, by the variable's name. */
const safeValues = (stepValuesMap: Record<string, unknown> | undefined): Record<string, unknown> | undefined =>
	stepValuesMap === undefined ? undefined : sanitizeObjectSecrets(stepValuesMap, isSecretName);

/** The fields a step's events share: its id, its line and where it is stated, its level, its intent and what ran it. */
const stepFields = (featureStep: TFeatureStep, called: TStepCalled, timestamp: number) => ({
	id: formatSeqPath(featureStep.seqPath),
	timestamp,
	kind: "lifecycle",
	type: "step",
	in: featureStep.in,
	lineNumber: featureStep.source?.lineNumber,
	featurePath: featureStep.source?.path,
	level: stepLevel(featureStep.isSubStep),
	intent: featureStep.intent ? { mode: featureStep.intent.mode } : undefined,
	stepperName: called.stepperName,
	actionName: called.actionName,
	stepValuesMap: safeValues(called.stepValuesMap),
});

/** A step's start. `isAsync` states whether its action runs apart from the step that called it. */
export const stepStartEvent = (featureStep: TFeatureStep, called: TStepCalled, isAsync: boolean, timestamp: number): TLifecycleEvent =>
	LifecycleEvent.parse({ ...stepFields(featureStep, called, timestamp), stage: "start", status: STATUS.running, isAsync });

/** A step's end: how it ended, why where it failed, and the products it retains. The event leaves out the error field
 *  where the step didn't fail, so a view doesn't show an error. */
export const stepEndEvent = (
	featureStep: TFeatureStep,
	called: TStepCalled,
	ended: { status: TStepEnd; error: string | Error | undefined; products: Record<string, unknown> | undefined },
	timestamp: number,
): TLifecycleEvent =>
	LifecycleEvent.parse({
		...stepFields(featureStep, called, timestamp),
		stage: "end",
		status: ended.status,
		error: ended.error === undefined ? undefined : errorDetail(ended.error),
		products: ended.products,
	});
