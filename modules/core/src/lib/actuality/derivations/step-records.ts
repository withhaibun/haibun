/**
 * A step's record: the SeqPath individual a step writes once at its start and once at its end. Its start states every
 * field a reader requires, and its end is its start with how it ended, so each is one write.
 */
import { EXECUTION_MODE, RECORDED_STATUS, stepLevel, type TRecordedStatus } from "../../../schema/protocol.js";
import type { TFeatureStep } from "../../steps/domains/stepper.js";
import { LinkRelations } from "../../resources.js";
import { itemAt } from "../../util/item-at.js";
import type { TWorld } from "../domains/world.js";
import { SEQ_PATH_FIELD, calledOf, formatRecordName } from "../domains/seq-path.js";

/** The authorization a step's own record states. A step actuality runs as itself holds every action, so its record
 *  doesn't state the invoked and held actions. The record of a caller's step states both. A record states the principal
 *  that proved its identity, where one did. */
export type TStepAuthorization = { invoked?: string; held?: string; controller?: string };

/** How a step reached what ran it: in this process, or on another instance at its origin. */
export type TStepRan = { ranVia: string; ranOn?: string };

/** A step's record as its start writes it, and as its end writes it again with how it ended. */
export type TStepRecord = Record<string, unknown>;

/** A step's record at its start, written at `at` (an ISO time). It states every field the SeqPath schema requires, so a
 *  reader that reads the record during the step reads a whole record. */
export function startRecord(execution: string, featureStep: TFeatureStep, authorization: TStepAuthorization, ran: TStepRan, at: string): TStepRecord {
	const record: TStepRecord = {
		[SEQ_PATH_FIELD.id]: formatRecordName({ execution, path: featureStep.seqPath }),
		// The execution that contains this step, as a field as well as the leading part of its id. A store filters on a
		// field, so one execution's steps can be read, counted and spanned together.
		[SEQ_PATH_FIELD.execution]: execution,
		[SEQ_PATH_FIELD.recordedAtTime]: at,
		[SEQ_PATH_FIELD.stepText]: featureStep.in,
		// The stepper and action that ran, beside the line's text. Without this field a step's record states only the
		// words of the line.
		[SEQ_PATH_FIELD.called]: calledOf(featureStep.action.stepperName, featureStep.action.actionName),
		[SEQ_PATH_FIELD.actionStatus]: RECORDED_STATUS.running,
		[SEQ_PATH_FIELD.generatedAtTime]: at,
		// Written for every step, including an authoritative one. A query for the steps that weren't speculative matches
		// only where ordinary steps state their mode as well. A step whose intent doesn't state a mode is authoritative.
		[SEQ_PATH_FIELD.mode]: featureStep.intent?.mode === EXECUTION_MODE.speculative ? EXECUTION_MODE.speculative : EXECUTION_MODE.authoritative,
		[SEQ_PATH_FIELD.ranVia]: ran.ranVia,
		// A call made into a running instance is a step actuality records. Its record has the same level as its events. That
		// level is below the level of actuality's own steps, so a reader of actuality isn't shown the calls of other readers.
		[SEQ_PATH_FIELD.level]: stepLevel(featureStep.isSubStep),
		...(ran.ranOn === undefined ? {} : { [SEQ_PATH_FIELD.ranOn]: ran.ranOn }),
		...(authorization.invoked === undefined ? {} : { [SEQ_PATH_FIELD.capabilityAction]: authorization.invoked }),
		...(authorization.held === undefined ? {} : { [SEQ_PATH_FIELD.allowedAction]: authorization.held }),
		...(authorization.controller === undefined ? {} : { [LinkRelations.PERFORMED_BY.rel]: authorization.controller }),
		...(featureStep.source?.path ? { [SEQ_PATH_FIELD.path]: featureStep.source.path } : {}),
	};
	if (featureStep.seqPath.length > 1) {
		record[LinkRelations.PART_OF.rel] = formatRecordName({ execution, path: featureStep.seqPath.slice(0, -1) });
		const lastIndex = itemAt(featureStep.seqPath, featureStep.seqPath.length - 1);
		if (lastIndex > 0) record[LinkRelations.PRECEDED_BY.rel] = formatRecordName({ execution, path: [...featureStep.seqPath.slice(0, -1), lastIndex - 1] });
	}
	return record;
}

/** How a step ended, as its record states it: its status, why where it failed, and the view it showed where it showed one. */
export type TStepEnded = { status: TRecordedStatus; error?: string; showed?: string };

/** A step's record at its end, written at `at` (an ISO time): its start with how it ended. The record's time of writing is
 *  its end, so a read of the records written since a given time returns the step's end. */
export const endRecord = (start: TStepRecord, ended: TStepEnded, at: string): TStepRecord => ({
	...start,
	[SEQ_PATH_FIELD.actionStatus]: ended.status,
	[SEQ_PATH_FIELD.endedAtTime]: at,
	[SEQ_PATH_FIELD.recordedAtTime]: at,
	...(ended.error ? { [SEQ_PATH_FIELD.error]: ended.error } : {}),
	...(ended.showed ? { [SEQ_PATH_FIELD.showed]: ended.showed } : {}),
});

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
