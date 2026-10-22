/**
 * A step's record: the SeqPath individual a step writes once at its start and once at its end. Its start states every
 * field a reader requires, and its end is its start with how it ended, so each is one write.
 */
import { RECORDED_STATUS, STATUS, stepLevel, type TActualityLevel, type TRecordedStatus, type TVerdict } from "../../domains/protocol.js";
import type { TFeatureStep } from "../../steps/domains/stepper.js";
import { LinkRelations, type AccessLevel } from "../../domains/resources.js";
import { itemAt } from "../../domains/item-at.js";
import type { TWorld } from "../domains/world.js";
import { SEQ_PATH_EDGE, SEQ_PATH_FIELD, STEP_LEVEL, calledOf, actualityFeatureOf, formatRecordName, levelPath, type TRecordName } from "../domains/seq-path.js";
import type { TActuality, TActualityMove } from "../machines/actuality.js";
import type { TStepFailure } from "../domains/step-failure.js";

/** The authorization a step's own record states. A step actuality runs as itself holds every action, so its record
 *  doesn't state the invoked and held actions. The record of a caller's step states both. A record states the principal
 *  that proved its identity, and the delegation the call was made under, where its caller states them. */
export type TStepAuthorization = { invoked?: string; held?: string; controller?: string; delegation?: string };

/** The call a step's record states: the read level of the call, the ask that holds the call, and the agent that made the
 *  call, where its caller names them. */
export type TStepCall = { accessLevel: AccessLevel; askedIn?: string; attributedTo?: string };

/** Returns the text of a step's products: their `text` where they hold one, else their JSON. */
export const resultText = (products: Record<string, unknown>): string => (typeof products.text === "string" ? products.text : JSON.stringify(products));

/** Returns the arguments a call carried by a transport sent, as JSON. A feature line states its arguments in its text, so its
 *  record doesn't repeat them. */
function paramsOf(featureStep: TFeatureStep): string | undefined {
	const values = featureStep.action.stepValuesMap;
	if (featureStep.programmatic !== true || values === undefined) return undefined;
	return JSON.stringify(Object.fromEntries(Object.entries(values).flatMap(([name, { value }]) => (value === undefined ? [] : [[name, value]]))));
}

/** How a step reached what ran it: in this process, or on another instance at its origin. */
export type TStepRan = { ranVia: string; ranOn?: string };

/** A step's record as its start writes it, and as its end writes it again with how it ended. */
export type TStepRecord = Record<string, unknown>;

/** A step's record at its start, written at `at` (an ISO time). It states every field the SeqPath schema requires, so a
 *  reader that reads the record during the step reads a whole record. */
export function startRecord(actualityFeature: string, featureStep: TFeatureStep, authorization: TStepAuthorization, ran: TStepRan, call: TStepCall, at: string): TStepRecord {
	const params = paramsOf(featureStep);
	const record: TStepRecord = {
		[SEQ_PATH_FIELD.id]: formatRecordName({ actuality: actualityFeature, path: featureStep.seqPath }),
		// The actuality feature that contains this step, as a field as well as the leading part of its id. A store filters on a
		// field, so the steps of one feature of an actuality can be read, counted and spanned together.
		[SEQ_PATH_FIELD.actuality]: actualityFeature,
		[SEQ_PATH_FIELD.recordedAtTime]: at,
		[SEQ_PATH_FIELD.stepText]: featureStep.in,
		// The stepper and action that ran, beside the line's text. Without this field a step's record states only the
		// words of the line.
		[SEQ_PATH_FIELD.called]: calledOf(featureStep.action.stepperName, featureStep.action.actionName),
		[SEQ_PATH_FIELD.actionStatus]: RECORDED_STATUS.running,
		[SEQ_PATH_FIELD.generatedAtTime]: at,
		[SEQ_PATH_FIELD.ranVia]: ran.ranVia,
		// A call made into a running instance is a step actuality records. Its record has the same level as its events. That
		// level is below the level of actuality's own steps, so a reader of actuality isn't shown the calls of other readers.
		[SEQ_PATH_FIELD.level]: stepLevel(featureStep.isSubStep),
		[SEQ_PATH_FIELD.actualityLevel]: STEP_LEVEL,
		[LinkRelations.ACCESS_LEVEL.rel]: call.accessLevel,
		...(params === undefined ? {} : { [SEQ_PATH_FIELD.params]: params }),
		...(call.askedIn === undefined ? {} : { [SEQ_PATH_EDGE.askedIn]: call.askedIn }),
		...(call.attributedTo === undefined ? {} : { [SEQ_PATH_FIELD.attributedTo]: call.attributedTo }),
		...(authorization.delegation === undefined ? {} : { [SEQ_PATH_FIELD.delegation]: authorization.delegation }),
		...(ran.ranOn === undefined ? {} : { [SEQ_PATH_FIELD.ranOn]: ran.ranOn }),
		...(authorization.invoked === undefined ? {} : { [SEQ_PATH_FIELD.capabilityAction]: authorization.invoked }),
		...(authorization.held === undefined ? {} : { [SEQ_PATH_FIELD.allowedAction]: authorization.held }),
		...(authorization.controller === undefined ? {} : { [LinkRelations.PERFORMED_BY.rel]: authorization.controller }),
		...(featureStep.source?.path ? { [SEQ_PATH_FIELD.path]: featureStep.source.path } : {}),
	};
	if (featureStep.seqPath.length > 1) {
		record[LinkRelations.PART_OF.rel] = formatRecordName({ actuality: actualityFeature, path: featureStep.seqPath.slice(0, -1) });
		const lastIndex = itemAt(featureStep.seqPath, featureStep.seqPath.length - 1);
		if (lastIndex > 0) record[LinkRelations.PRECEDED_BY.rel] = formatRecordName({ actuality: actualityFeature, path: [...featureStep.seqPath.slice(0, -1), lastIndex - 1] });
	}
	return record;
}

/** How a step ended, as its record states it: its status, its goal's verdict, why where it failed, the view it showed where it
 *  showed one, and the whole text a call carried by a transport read back where the step produced products, which the
 *  record's result Body holds. */
export type TStepEnded = { status: TRecordedStatus; verdict?: TVerdict; error?: string; showed?: string; result?: string };

/** A step's record at its end, written at `at` (an ISO time): its start with how it ended. The record's time of writing is
 *  its end, so a read of the records written since a given time returns the step's end. */
export const endRecord = (start: TStepRecord, ended: TStepEnded, at: string): TStepRecord => ({
	...start,
	[SEQ_PATH_FIELD.actionStatus]: ended.status,
	[SEQ_PATH_FIELD.endedAtTime]: at,
	[SEQ_PATH_FIELD.recordedAtTime]: at,
	...(ended.verdict === undefined ? {} : { [SEQ_PATH_FIELD.verdict]: ended.verdict }),
	...(ended.error ? { [SEQ_PATH_FIELD.error]: ended.error } : {}),
	...(ended.showed ? { [SEQ_PATH_FIELD.showed]: ended.showed } : {}),
	...(ended.result === undefined ? {} : { [SEQ_PATH_FIELD.result]: ended.result }),
});

/** What names actuality's levels: the key of the process that runs it, and the host that leads its step paths. */
export type TLevelNaming = { key: string; hostId: number };

/** A failed step as one line: its id, and its text and its message where its end states them. */
export const failureText = (failure: TStepFailure): string =>
	[`${failure.id}:`, failure.step, failure.message === undefined ? undefined : `(${failure.message})`].filter((part) => part !== undefined).join(" ");

/** The name of a level's record: the actuality's, the `featureNum`th feature's, or a scenario of it by its ordinal. */
const levelName = (naming: TLevelNaming, featureNum: number, scenario: number): TRecordName =>
	featureNum === 0
		? { actuality: actualityFeatureOf({ key: naming.key, featureNum }), path: [] }
		: { actuality: actualityFeatureOf({ key: naming.key, featureNum }), path: levelPath(naming.hostId, featureNum, scenario) };

/** Where a level's record is: its name, its heading, the feature file it states, and the records it is part of and follows. */
type TLevelAt = { name: TRecordName; heading: string; source?: string; partOf?: TRecordName; precededBy?: TRecordName };

function levelAt(move: TActualityMove, after: TActuality, naming: TLevelNaming): TLevelAt {
	const featureNum = after.features.length;
	if (move.type === "actuality") {
		if (move.in === undefined) throw new Error("the actuality's start doesn't state its heading; the Executor states the base of its features");
		return { name: levelName(naming, 0, 0), heading: move.in };
	}
	const feature = itemAt(after.features, featureNum - 1);
	if (feature.name === undefined || feature.path === undefined) throw new Error(`the feature ${feature.id} doesn't state its name and path; featureEvent states both`);
	if (move.type === "feature")
		return {
			name: levelName(naming, featureNum, 0),
			heading: feature.name,
			source: feature.path,
			partOf: levelName(naming, 0, 0),
			...(featureNum > 1 ? { precededBy: levelName(naming, featureNum - 1, 0) } : {}),
		};
	const scenario = itemAt(feature.scenarios, feature.scenarios.length - 1);
	if (scenario.name === undefined) throw new Error(`the scenario ${scenario.id} doesn't state its name; scenarioEvent states it`);
	const ordinal = feature.scenarios.length;
	const precededBy = ordinal > 1 ? { precededBy: levelName(naming, featureNum, ordinal - 1) } : {};
	return { name: levelName(naming, featureNum, ordinal), heading: scenario.name, source: feature.path, partOf: levelName(naming, featureNum, 0), ...precededBy };
}

/**
 * The record of the level a move of the actuality machine starts or ends, from the state after the move: the
 * actuality's, a feature's or a scenario's. Its start states the level's heading, the record it is part of and the
 * record of the level before it. Its end is its start with how the level ended, and with the first failure of a
 * feature or of the actuality that failed. The move happened at `timestamp`. Returns undefined for a step's move,
 * whose record dispatchStep writes. Throws for an end without its start's record.
 */
export function levelRecord(
	move: TActualityMove,
	after: TActuality,
	naming: TLevelNaming,
	started: TStepRecord | undefined,
	timestamp: number,
	accessLevel: AccessLevel,
): TStepRecord | undefined {
	if (move.type === "step") return undefined;
	const at = new Date(timestamp).toISOString();
	if (move.stage === "end") {
		if (started === undefined) throw new Error(`the ${move.type} ${move.id} ended without the record of its start; move a level's start before its end`);
		const status = Object.entries(RECORDED_STATUS).find(([word]) => word === move.status && word !== STATUS.running)?.[1];
		if (status === undefined) throw new Error(`the ${move.type} ${move.id} ended as ${move.status}, which doesn't end a level`);
		const failed = status === RECORDED_STATUS.failed ? after : undefined;
		const failure = move.type === "actuality" ? failed?.failures[0] : move.type === "feature" ? failed?.features.at(-1)?.firstFailure : undefined;
		return endRecord(started, { status, ...(failure === undefined ? {} : { error: failureText(failure) }) }, at);
	}
	const { name, heading, source, partOf, precededBy } = levelAt(move, after, naming);
	const level: TActualityLevel = move.type;
	return {
		[SEQ_PATH_FIELD.id]: formatRecordName(name),
		[SEQ_PATH_FIELD.actuality]: name.actuality,
		[SEQ_PATH_FIELD.recordedAtTime]: at,
		[SEQ_PATH_FIELD.stepText]: heading,
		[SEQ_PATH_FIELD.actionStatus]: RECORDED_STATUS.running,
		[SEQ_PATH_FIELD.generatedAtTime]: at,
		[SEQ_PATH_FIELD.level]: stepLevel(false),
		[SEQ_PATH_FIELD.actualityLevel]: level,
		[LinkRelations.ACCESS_LEVEL.rel]: accessLevel,
		...(source === undefined ? {} : { [SEQ_PATH_FIELD.path]: source }),
		...(partOf === undefined ? {} : { [LinkRelations.PART_OF.rel]: formatRecordName(partOf) }),
		...(precededBy === undefined ? {} : { [LinkRelations.PRECEDED_BY.rel]: formatRecordName(precededBy) }),
	};
}

/** Returns the name of the view a step showed, where it showed one. The step's products carry the view's declared name
 *  as `view`. The view's declaration states its appearance. */
export function viewShown(products: Record<string, unknown> | undefined): string | undefined {
	const view = products?.view;
	return typeof view === "string" ? view : undefined;
}

/** Returns a step as its records state it. The step's line and values state the text that `recordedAs` returns in place
 *  of a value, where the value's domain declares `recordedAs`. */
export function asRecorded(featureStep: TFeatureStep, domains: TWorld["domains"]): TFeatureStep {
	const values = featureStep.action.stepValuesMap;
	if (!values) return featureStep;
	const restated = Object.entries(values).flatMap(([name, value]) => {
		const recordedAs = value.domain ? domains[value.domain]?.recordedAs : undefined;
		return recordedAs && value.term ? [{ name, value, term: value.term, stated: recordedAs(value.value ?? value.term) }] : [];
	});
	if (restated.length === 0) return featureStep;
	const statedValues = { ...values };
	let line = featureStep.in;
	for (const { name, value, term, stated } of restated) {
		statedValues[name] = { ...value, term: stated, value: stated };
		line = line.split(term).join(stated);
	}
	return { ...featureStep, in: line, action: { ...featureStep.action, stepValuesMap: statedValues } };
}
