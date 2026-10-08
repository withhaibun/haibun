/**
 * A SeqPath individual holds a step's hierarchical identifier in the graph.
 *
 * dispatchStep writes a SeqPath individual into the shared store for each step it records.
 * The `isPartOf` edge links each individual to its parent, so the individuals form a tree.
 * A step with the seqPath `0.1.2.5` has the parent `0.1.2`. A record that a step emits
 * references the step through an `isPartOf` edge or a `seqPath` property. A query follows
 * these links from any individual to the whole execution graph.
 *
 * resources.ts declares the label (SEQ_PATH_LABEL) and the lifecycle status enum
 * (SEQ_PATH_STATUS). This file declares the schema, the domain selectors and the
 * domain definition that steppers register.
 */
import { itemAt } from "./util/item-at.js";
import { z } from "zod";
import { EXECUTION_MODES, HAIBUN_LOG_LEVELS } from "../schema/protocol.js";
import { LinkRelations, PersistedVertexSchema, PRINCIPAL_LABEL, SEQ_PATH_LABEL, SEQ_PATH_STATUS, type TDomainDefinition } from "./resources.js";

const SEQ_PATH_DOMAIN = "seq-path";

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

/** Returns a fact's id. The id holds the seqPath of the step that produced the fact. The id also names the product
 *  field where the fact is one field of the product. */
export function factIdOf(seqPathKey: string, field?: string): string {
	return field === undefined ? seqPathKey : `${seqPathKey}${FACT_FIELD_MARK}${field}`;
}

/** Reads the seqPath of the step that produced a fact from the fact's id. Returns null where the id doesn't name a step. */
export function factSeqPath(factId: string): number[] | null {
	return parseSeqPath(itemAt(factId.split(FACT_FIELD_MARK), 0));
}

/** Returns the seqPath of the step that produced a fact. Throws where the id doesn't name a step, since a fact's id is
 *  the seqPath of the step that produced it. */
export function producingStep(factId: string): number[] {
	const seqPath = factSeqPath(factId);
	if (!seqPath) throw new Error(`fact "${factId}" doesn't name a step: a fact's id is the seqPath of the step that produced it`);
	return seqPath;
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
	/** Whether the step's outcome is authoritative or speculative. A speculative step's failure is expected, so a
	 *  reader that looks for failures selects the authoritative steps. emitSeqPathStart writes the mode on every step's
	 *  record because a query for the steps that aren't speculative matches only records that hold a mode. */
	mode: "mode",
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
} as const;

/** SeqPath edge names. */
export const SEQ_PATH_EDGE = {
	isPartOf: "isPartOf",
	precededBy: "precededBy",
	/** The principal whose capability allowed this step, where one did. It is an actor edge, so a sequence view draws
	 *  the step on that principal's lifeline and not as a step that references the principal. */
	performedBy: "performedBy",
} as const;

const STATUS_VALUES = Object.values(SEQ_PATH_STATUS) as [string, ...string[]];

// Non-strict: emitSeqPathStart writes isPartOf, precededBy and performedBy in the
// same upsert as the individual properties. The topology declares them as edges,
// and the start record inlines them. Strict mode would reject those keys before
// upsertIndividual routes them. CommentSchema and BodySchema are non-strict for
// the same reason.
export const SeqPathSchema = PersistedVertexSchema.extend({
	[SEQ_PATH_FIELD.id]: z.string(),
	[SEQ_PATH_FIELD.stepText]: z.string(),
	[SEQ_PATH_FIELD.called]: z.string().optional(),
	[SEQ_PATH_FIELD.actionStatus]: z.enum(STATUS_VALUES),
	[SEQ_PATH_FIELD.error]: z.string().optional(),
	[SEQ_PATH_FIELD.showed]: z.string().optional(),
	[SEQ_PATH_FIELD.capabilityAction]: z.string().optional(),
	[SEQ_PATH_FIELD.allowedAction]: z.string().optional(),
	[SEQ_PATH_FIELD.generatedAtTime]: z.string(),
	[SEQ_PATH_FIELD.endedAtTime]: z.string().optional(),
	[SEQ_PATH_FIELD.path]: z.string().optional(),
	[SEQ_PATH_FIELD.mode]: z.enum(EXECUTION_MODES).optional(),
	[SEQ_PATH_FIELD.ranVia]: z.enum(["local", "remote"]).optional(),
	[SEQ_PATH_FIELD.ranOn]: z.string().optional(),
	[SEQ_PATH_FIELD.level]: z.enum(HAIBUN_LOG_LEVELS).optional(),
	[SEQ_PATH_FIELD.execution]: z.string().optional(),
	[SEQ_PATH_FIELD.recordedAtTime]: z.string().optional(),
});
export type TSeqPath = z.infer<typeof SeqPathSchema>;

export const seqPathDomainDefinition: TDomainDefinition = {
	selectors: [SEQ_PATH_DOMAIN],
	schema: SeqPathSchema,
	description:
		"A step in an automated run: its text, the action it called, and how it ended. Each record made during the step references it, so you can see when and where the record was produced.",
	topology: {
		persistedAs: SEQ_PATH_LABEL,
		id: SEQ_PATH_FIELD.id,
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
			// Grouped-as, so the type offers each mode as a sub-filter, and a reader doesn't type a condition on the field.
			[SEQ_PATH_FIELD.mode]: LinkRelations.CONTEXT.rel,
			// Grouped-as, so the type offers "the steps another host ran" as a filter, and a reader doesn't write a condition.
			[SEQ_PATH_FIELD.ranVia]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.ranOn]: LinkRelations.RAN_ON.rel,
			[SEQ_PATH_FIELD.level]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.execution]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.recordedAtTime]: LinkRelations.RECORDED_AT_TIME.rel,
		},
		edges: {
			[SEQ_PATH_EDGE.isPartOf]: { rel: LinkRelations.PART_OF.rel, range: SEQ_PATH_LABEL },
			[SEQ_PATH_EDGE.precededBy]: { rel: LinkRelations.PRECEDED_BY.rel, range: SEQ_PATH_LABEL },
			[SEQ_PATH_EDGE.performedBy]: { rel: LinkRelations.PERFORMED_BY.rel, range: PRINCIPAL_LABEL },
		},
		// endedAtTime orders steps by their end. A reader that follows actuality compares recordedAtTime with the time of
		// its last read. execution selects one execution's steps.
		sortColumns: { [SEQ_PATH_FIELD.endedAtTime]: "TIMESTAMPTZ", [SEQ_PATH_FIELD.recordedAtTime]: "TIMESTAMPTZ", [SEQ_PATH_FIELD.execution]: "TEXT" },
	},
};
