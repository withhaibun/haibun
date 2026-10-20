/**
 * A SeqPath individual holds a step's hierarchical identifier in the graph.
 *
 * dispatchStep writes a SeqPath individual into the shared store for each step it records.
 * The `isPartOf` edge links each individual to its parent, so the individuals form a tree.
 * A step with the seqPath `0.1.2.5` has the parent `0.1.2`. A record that a step emits
 * references the step through an `isPartOf` edge or a `seqPath` property. A query follows
 * these links from any individual to the whole execution graph.
 *
 * resources.ts declares the label (SEQ_PATH_LABEL), and protocol.ts the words a record
 * stores for its status (RECORDED_STATUS). This file declares the schema, the domain
 * selectors and the domain definition that steppers register.
 */
import { itemAt } from "../../domains/item-at.js";
import { z } from "zod";
import { ACTUALITY_LEVELS, HAIBUN_LOG_LEVELS, RECORDED_STATUS, VERDICT, type TActualityLevel } from "../../domains/protocol.js";
import { MEDIA_TYPE } from "../../domains/media-types.js";
import { SYNTHETIC_FEATURE_NUM } from "../../domains/host-id.js";
import {
	Access,
	AccessLevelSchema,
	COMMENT_LABEL,
	LinkRelations,
	PersistedVertexSchema,
	PRINCIPAL_LABEL,
	SEQ_PATH_LABEL,
	type TDomainDefinition,
} from "../../domains/resources.js";

const SEQ_PATH_DOMAIN = "seq-path";

// SeqPath conventions:
// - Feature execution uses [hostId, feature, scenario, step, ...], and a line's proof extends the line's path with each
//   position of the proof.
// - An ad hoc transport call uses [hostId, SYNTHETIC_FEATURE_NUM, adHocSeq] (host-id.ts).

/** The segments of a feature line's path, [hostId, feature, scenario, step], and of a call a transport carries, [hostId,
 *  SYNTHETIC_FEATURE_NUM, adHocSeq]. */
const FEATURE_LINE_SEGMENTS = 4;
const TRANSPORTED_CALL_SEGMENTS = 3;

/** The path of the line that contains a step: the outermost step whose path is a prefix of the step's. A step's record is
 *  part of the record of its path's prefix, so the line's record is the outermost step's record. */
export const linePathOf = (path: number[]): number[] => path.slice(0, path[1] === SYNTHETIC_FEATURE_NUM ? TRANSPORTED_CALL_SEGMENTS : FEATURE_LINE_SEGMENTS);

/** Format a hierarchical seqPath number array as the canonical string id (e.g. [0,1,2,5] → "0.1.2.5"). */
export function formatSeqPath(seqPath: number[]): string {
	return seqPath.join(".");
}

/** Parse the canonical dot-joined form back to the number tuple. Returns null when the input isn't seqPath-shaped.
 *  An empty segment isn't a zero, so `1..2` isn't a seqPath. */
export function parseSeqPath(id: string): number[] | null {
	if (!/^-?\d+(\.-?\d+)*$/.test(id)) return null;
	return id.split(".").map((p) => Number.parseInt(p, 10));
}

/** Joins the stepper name and the action name with a dot into the `called` value of a step's record. */
export const calledOf = (stepperName: string, actionName: string): string => `${stepperName}.${actionName}`;

/** Splits the `called` value of a step's record into the stepper name and the action name. */
export function calledParts(called: string): { stepperName: string; actionName: string } {
	const at = called.indexOf(".");
	if (at < 1 || at === called.length - 1) throw new Error(`"${called}" doesn't name a stepper and action`);
	return { stepperName: called.slice(0, at), actionName: called.slice(at + 1) };
}

/** Separates a fact's seqPath from the product field in a fact's id. A fact's id names a field where the step's
 *  product has a domain for each field. */
const FACT_FIELD_MARK = "#";

/** Returns a fact's id: the record name of the step that produced the fact, which holds the execution and the step path,
 *  followed by the product field where the fact is one field of the product. */
export function factIdOf(step: TRecordName, field?: string): string {
	const named = formatRecordName(step);
	return field === undefined ? named : `${named}${FACT_FIELD_MARK}${field}`;
}

/** Reads the step path of the step that produced a fact from the fact's id. Returns null where the id doesn't name a step's record. */
export function factSeqPath(factId: string): number[] | null {
	return parseRecordName(itemAt(factId.split(FACT_FIELD_MARK), 0))?.path ?? null;
}

/** Returns the record name of the step that produced a fact, which opens as that step's record. Throws where the id doesn't
 *  name a step's record, since a fact's id is the record name of the step that produced it. */
export function producingStepRecord(factId: string): string {
	const named = itemAt(factId.split(FACT_FIELD_MARK), 0);
	if (parseRecordName(named) === undefined) throw new Error(`fact "${factId}" doesn't name a step: a fact's id is the record name of the step that produced it`);
	return named;
}

/**
 * Returns the leading dot-joined integer seqPath of an id and discards any suffix. Returns null where the id doesn't
 * begin with one. An event's id begins with the seqPath of the step that emitted the event.
 *
 * Examples: "0.1.5.3" → "0.1.5.3"; "0.1.5.3.artifact.0" → "0.1.5.3"; "foo.bar" → null.
 */
export function extractSeqPathPrefix(id: string): string | null {
	const match = id.match(/^-?\d+(?:\.-?\d+)*/);
	return match ? match[0] : null;
}

/** The field that holds a record's execution id. A record's id names its execution too. A store filters on a field and
 *  not on part of an id, so a reader selects one execution's records, counts them and reads their first and last
 *  times through this field. */
export const EXECUTION_FIELD = "execution";

/** The field that holds the time a record was written. Each later write of the record sets it
 *  again. A record is written after the moment it describes. A reader that follows an execution requests the records
 *  written since its last read, and that selection is exact. A selection by the moment a record describes misses a
 *  record written late. */
export const RECORDED_AT_TIME_FIELD = "recordedAtTime";

/**
 * Returns the id of one feature's execution: the key of the process start and the feature's number. Two executions of
 * one feature produce the same step paths, so a path alone doesn't identify a step. The execution id distinguishes one
 * execution of a feature from another. A reader that returns to an execution reads by this id.
 */
export function executionOf(tag: { key: string; featureNum: number }): string {
	return `${tag.key}-${tag.featureNum}`;
}

/**
 * Returns the key of the actuality that contains an execution: the part of the execution id before its feature's number.
 * Every feature of one actuality takes that key, so a reader selects, lists and deletes an actuality's records by it.
 * Throws for an id that executionOf didn't return.
 */
export function actualityOf(execution: string): string {
	if (!RecordNameSchema.shape.execution.safeParse(execution).success) throw new Error(`"${execution}" isn't an execution id, which executionOf returns`);
	return execution.slice(0, execution.indexOf("-"));
}

/**
 * The name of a record of an execution. It holds the execution, the step path within that execution, and the ordinal
 * of an item a step logged or produced. Every record name has this one form, so a reader parses one shape and doesn't
 * match several.
 */
export const RecordNameSchema = z
	.object({
		/** The execution id that executionOf returns: when the process began and which of its features executed. */
		execution: z.string().regex(/^\d+--?\d+$/),
		/** The step path within that execution. It is empty for a record that actuality logged outside every step. */
		path: z.array(z.number().int()),
		/** The ordinal of an item one step logged or produced. The step's own record doesn't carry one. */
		ordinal: z.number().int().nonnegative().optional(),
	})
	.strict();
export type TRecordName = z.infer<typeof RecordNameSchema>;

/** Formats a record name as the id the record carries. */
export function formatRecordName(name: TRecordName): string {
	const under = [name.execution, ...name.path].join(".");
	return name.ordinal === undefined ? under : `${under}@${name.ordinal}`;
}

/** Parses a record's id into its name. Returns undefined where the id doesn't name a record of an execution. */
export function parseRecordName(id: string): TRecordName | undefined {
	const parts = id.split("@");
	const [execution, ...path] = itemAt(parts, 0).split(".");
	const ordinal = parts[1];
	const parsed = RecordNameSchema.safeParse({
		execution,
		path: path.map((p) => Number.parseInt(p, 10)),
		...(ordinal === undefined ? {} : { ordinal: Number.parseInt(ordinal, 10) }),
	});
	return parsed.success ? parsed.data : undefined;
}

/**
 * Total order on seqPath tuples by lexicographic segment compare. Shorter
 * prefixes precede their extensions. This matches the depth-first order in
 * which dispatch assigns seqPaths. Returns -1 / 0 / 1.
 */
export function compareSeqPath(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const x = itemAt(a, i);
		const y = itemAt(b, i);
		if (x !== y) return x < y ? -1 : 1;
	}
	if (a.length !== b.length) return a.length < b.length ? -1 : 1;
	return 0;
}

/** The actuality level of a dispatched step's record. Every other record of the type is a level's: the execution's, a
 *  feature's or a scenario's. */
export const STEP_LEVEL: TActualityLevel = "step";

/** SeqPath individual field names. The schema, the topology and the emitters read them from here. */
export const SEQ_PATH_FIELD = {
	id: "id",
	stepText: "stepText",
	/** The stepper and the action the step called, as `Stepper.action`. The step's text holds the request; this field holds the action that executed. */
	called: "called",
	actionStatus: "actionStatus",
	/** The reason a step failed. It is written only on a failed step, since the failure is a fact about that step. */
	error: "error",
	/** The name of the view this step showed, as the site declares it. The site's declaration holds how the view
	 *  looks, so the record holds the view's name and not a copy of the declaration. */
	showed: "showed",
	/** The capability a caller must hold to run this step. It is written only where the step declares one. */
	capabilityAction: "capabilityAction",
	/** The actions of the grant the caller held that allowed this step. The record holds the actions and never the token.
	 *  A bearer token is the credential itself, so a record of the token would copy the credential. */
	allowedAction: "allowedAction",
	generatedAtTime: "generatedAtTime",
	endedAtTime: "endedAtTime",
	path: "path",
	/** How the logic engine ended the step's goal: proved, refuted, unknown or a contradiction. A nested call that is
	 *  refuted doesn't fail its line, so a reader that looks for failures reads the verdict of each line. */
	verdict: "verdict",
	/** Whether the step executed in this process (`local`) or on another host (`remote`). The step's record holds this
	 *  fact about the step, and a separate trace doesn't. */
	ranVia: "ranVia",
	/** The origin of the other instance that executed the step, where one did. */
	ranOn: "ranOn",
	/** The log level of the step. An ordinary step reports at `info`. A substep reports at `trace`, and a call made into a
	 *  running instance is a substep. The record holds the level because a filter by level reads records. A page's own
	 *  calls are steps that actuality records like any other step. */
	level: "level",
	/** The execution that contains this step. Every writer writes it. A record without one predates the field, and a
	 *  reader can't request that record by its execution. */
	execution: EXECUTION_FIELD,
	/** When this record was written. It is written again at the step's end. */
	recordedAtTime: RECORDED_AT_TIME_FIELD,
	/** The level of the execution the record is of: the execution, a feature, a scenario or a step. Every writer writes it.
	 *  A record without one predates the field, and a reader can't select it by its level. */
	actualityLevel: "actualityLevel",
	/** The arguments a call carried by a transport sent, as JSON. A feature line states its arguments in its text. */
	params: "params",
	/** The head of the text a call carried by a transport read back, where the step produced products. */
	result: "result",
	/** The agent the call is attributed to, where its caller states one: the model whose turn made the call. */
	attributedTo: "attributedTo",
	/** The delegation the call was made under, where its caller states one. */
	delegation: "delegation",
	/** A level's digests as JSON text (digest.ts): the actuality's of each dependency root, and a scenario's of its declared lines. */
	digest: "digest",
} as const;

/** The declared level of a SeqPath record. A call that a read ceiling bounds writes its record at that ceiling. */
export const SEQ_PATH_ACCESS = Access.private;

/** SeqPath edge names. */
export const SEQ_PATH_EDGE = {
	isPartOf: "isPartOf",
	precededBy: "precededBy",
	/** The principal whose capability allowed this step, where one did. It is an actor edge, so a sequence view draws
	 *  the step on that principal's lifeline and not as a step that references the principal. */
	performedBy: "performedBy",
	/** The Comment that holds the ask under which an execution started, where one did. Its rel is `as:inReplyTo`. */
	askedIn: "askedIn",
} as const;

// Non-strict: emitSeqPathStart writes isPartOf, precededBy and performedBy in the
// same upsert as the individual properties. The topology declares them as edges,
// and the start record inlines them. Strict mode would reject those keys before
// upsertIndividual routes them. CommentSchema and BodySchema are non-strict for
// the same reason.
/** Where a step ran: in this process, or on another host. */
const RAN_VIA = ["local", "remote"] as const;

/** A text field a record may not hold. */
const OPTIONAL_TEXT = z.string().optional();

export const SeqPathSchema = PersistedVertexSchema.extend({
	[SEQ_PATH_FIELD.id]: z.string(),
	[SEQ_PATH_FIELD.stepText]: z.string(),
	[SEQ_PATH_FIELD.called]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.actionStatus]: z.enum(RECORDED_STATUS),
	[SEQ_PATH_FIELD.error]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.showed]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.capabilityAction]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.allowedAction]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.generatedAtTime]: z.string(),
	[SEQ_PATH_FIELD.endedAtTime]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.path]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.verdict]: z.enum(VERDICT).optional(),
	[SEQ_PATH_FIELD.ranVia]: z.enum(RAN_VIA).optional(),
	[SEQ_PATH_FIELD.ranOn]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.level]: z.enum(HAIBUN_LOG_LEVELS),
	[SEQ_PATH_FIELD.execution]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.recordedAtTime]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.actualityLevel]: z.enum(ACTUALITY_LEVELS).optional(),
	// Every writer states the level, the read level of the record's call, so a record without one is refused.
	[LinkRelations.ACCESS_LEVEL.rel]: AccessLevelSchema,
	[SEQ_PATH_FIELD.params]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.result]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.attributedTo]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.delegation]: OPTIONAL_TEXT,
	[SEQ_PATH_FIELD.digest]: OPTIONAL_TEXT,
	// A store that writes an edge for each edge field the schema declares writes the ask as an edge, so a read of the records
	// that reply to an ask selects them.
	[SEQ_PATH_EDGE.askedIn]: OPTIONAL_TEXT,
});
export type TSeqPath = z.infer<typeof SeqPathSchema>;

/** A step as a line reads it: its words, the action that ran it, how it ended and why where it failed, when it began and
 *   ended and how long it took, how it reached what ran it, and the capability it required, what allowed it and who held it. */
export const StepLineSchema = z.object({
	text: z.string(),
	called: OPTIONAL_TEXT,
	status: z.enum(RECORDED_STATUS),
	error: OPTIONAL_TEXT,
	began: z.string(),
	ended: OPTIONAL_TEXT,
	tookMs: z.number().optional(),
	dispatch: z.object({ via: z.enum(RAN_VIA), on: OPTIONAL_TEXT }).optional(),
	action: z.object({ required: z.string(), allowed: OPTIONAL_TEXT, holder: OPTIONAL_TEXT }).optional(),
});
export type TStepLine = z.infer<typeof StepLineSchema>;

/** Returns a step record's line. Throws for a record that isn't a step's. */
export function stepLine(record: Record<string, unknown>): TStepLine {
	const step = SeqPathSchema.parse(record);
	const began = step[SEQ_PATH_FIELD.generatedAtTime];
	const ended = step[SEQ_PATH_FIELD.endedAtTime];
	const via = step[SEQ_PATH_FIELD.ranVia];
	const on = step[SEQ_PATH_FIELD.ranOn];
	const required = step[SEQ_PATH_FIELD.capabilityAction];
	const allowed = step[SEQ_PATH_FIELD.allowedAction];
	const performedBy = record[SEQ_PATH_EDGE.performedBy];
	if (performedBy !== undefined && typeof performedBy !== "string") throw new Error(`the step ${step.id} names the principal who performed it as ${typeof performedBy}, not an id`);
	const called = step[SEQ_PATH_FIELD.called];
	const error = step[SEQ_PATH_FIELD.error];
	return {
		text: step[SEQ_PATH_FIELD.stepText],
		status: step[SEQ_PATH_FIELD.actionStatus],
		began,
		...(called === undefined ? {} : { called }),
		...(error === undefined ? {} : { error }),
		...(ended === undefined ? {} : { ended, tookMs: Date.parse(ended) - Date.parse(began) }),
		...(via === undefined ? {} : { dispatch: on === undefined ? { via } : { via, on } }),
		...(required === undefined ? {} : { action: { required, ...(allowed === undefined ? {} : { allowed }), ...(performedBy === undefined ? {} : { holder: performedBy }) } }),
	};
}

export const seqPathDomainDefinition: TDomainDefinition = {
	selectors: [SEQ_PATH_DOMAIN],
	schema: SeqPathSchema,
	description: "An actuality, feature, scenario or step.",
	// A step opens as the view of its record (CA4D9), as core declares the affordances panel's view.
	ui: { component: "shu-step-detail" },
	topology: {
		persistedAs: SEQ_PATH_LABEL,
		accessLevel: SEQ_PATH_ACCESS,
		id: SEQ_PATH_FIELD.id,
		// A record is titled by its heading or its step's text, so a graph of an actuality reads as its features, scenarios and steps.
		displayLabel: SEQ_PATH_FIELD.stepText,
		instrumentation: true,
		properties: {
			[SEQ_PATH_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			[SEQ_PATH_FIELD.stepText]: LinkRelations.CONTENT.rel,
			[SEQ_PATH_FIELD.called]: LinkRelations.CALLED.rel,
			[SEQ_PATH_FIELD.actionStatus]: LinkRelations.ACTION_STATUS.rel,
			[SEQ_PATH_FIELD.error]: LinkRelations.CONTENT.rel,
			// Grouped-as, so the type offers a filter such as "the steps that showed the graph".
			[SEQ_PATH_FIELD.showed]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.capabilityAction]: LinkRelations.CAPABILITY_ACTION.rel,
			[SEQ_PATH_FIELD.allowedAction]: LinkRelations.ALLOWED_ACTION.rel,
			[SEQ_PATH_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[SEQ_PATH_FIELD.endedAtTime]: LinkRelations.ENDED_AT_TIME.rel,
			[SEQ_PATH_FIELD.path]: LinkRelations.SOURCE_PATH.rel,
			[SEQ_PATH_FIELD.verdict]: LinkRelations.OUTCOME.rel,
			// Grouped-as, so the type offers "the steps another host ran" as a filter, and a reader doesn't write a condition.
			[SEQ_PATH_FIELD.ranVia]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.ranOn]: LinkRelations.RAN_ON.rel,
			[SEQ_PATH_FIELD.level]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.execution]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.recordedAtTime]: LinkRelations.RECORDED_AT_TIME.rel,
			// Grouped-as, so the type offers each level as a filter, such as "the executions" or "the scenarios".
			[SEQ_PATH_FIELD.actualityLevel]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.params]: { rel: LinkRelations.CONTENT.rel, mediaType: MEDIA_TYPE.json },
			// The result is a text of its own, so it is a Body of its own kind beside the parameters.
			[SEQ_PATH_FIELD.result]: { rel: LinkRelations.CONTENT.rel, mediaType: MEDIA_TYPE.plain, kind: SEQ_PATH_FIELD.result },
			[SEQ_PATH_FIELD.attributedTo]: LinkRelations.ATTRIBUTED_TO.rel,
			// Grouped-as, so the type offers "the calls made under this delegation" as a filter.
			[SEQ_PATH_FIELD.delegation]: LinkRelations.CONTEXT.rel,
			// Grouped-as, so the type offers the records of one state as a filter, such as the scenarios that declare the same lines.
			[SEQ_PATH_FIELD.digest]: LinkRelations.CONTEXT.rel,
		},
		edges: {
			[SEQ_PATH_EDGE.isPartOf]: { rel: LinkRelations.PART_OF.rel, range: SEQ_PATH_LABEL },
			[SEQ_PATH_EDGE.precededBy]: { rel: LinkRelations.PRECEDED_BY.rel, range: SEQ_PATH_LABEL },
			[SEQ_PATH_EDGE.performedBy]: { rel: LinkRelations.PERFORMED_BY.rel, range: PRINCIPAL_LABEL },
			[SEQ_PATH_EDGE.askedIn]: { rel: LinkRelations.IN_REPLY_TO.rel, range: COMMENT_LABEL },
		},
		// endedAtTime orders steps by their end. A reader that follows actuality compares recordedAtTime with the time of
		// its last read. execution selects one execution's steps.
		sortColumns: { [SEQ_PATH_FIELD.endedAtTime]: "TIMESTAMPTZ", [SEQ_PATH_FIELD.recordedAtTime]: "TIMESTAMPTZ", [SEQ_PATH_FIELD.execution]: "TEXT" },
	},
};
