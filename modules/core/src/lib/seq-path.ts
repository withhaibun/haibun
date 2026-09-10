/**
 * SeqPath: the hierarchical step identifier reified as a graph individual.
 *
 * Every dispatched step writes a SeqPath individual into the shared quad store
 * via dispatchStep. Individuals form a tree via the `isPartOf` edge: a step
 * with seqPath `0.1.2.5` has parent `0.1.2`. Other emissions within a
 * step's run carry a `seqPath` quad pointing back at the step's id, so
 * the entire execution graph queryable from any individual.
 *
 * The label and lifecycle status enum live in resources.ts (SEQ_PATH_LABEL,
 * SEQ_PATH_STATUS). This file owns the schema, domain selectors, and the
 * domain definition steppers register.
 */
import { z } from "zod";
import { EXECUTION_MODES, HAIBUN_LOG_LEVELS } from "../schema/protocol.js";
import { AccessLevelSchema, LinkRelations, PRINCIPAL_LABEL, SEQ_PATH_LABEL, SEQ_PATH_STATUS, type TDomainDefinition } from "./resources.js";

export const SEQ_PATH_DOMAIN = "seq-path";

/** Format a hierarchical seqPath number array as the canonical string id (e.g. [0,1,2,5] → "0.1.2.5"). */
export function formatSeqPath(seqPath: number[]): string {
	return seqPath.join(".");
}

/** Parse the canonical dot-joined form back to the number tuple. Returns null when the input is not seqPath-shaped:
 *  an empty segment is not a zero, so `1..2` is not a seqPath. */
export function parseSeqPath(id: string): number[] | null {
	if (!/^-?\d+(\.-?\d+)*$/.test(id)) return null;
	return id.split(".").map((p) => Number.parseInt(p, 10));
}

/**
 * The leading dot-joined integer seqPath of an id, discarding any suffix; null where the id does not begin with one.
 * This reads an id an event carries, which names a step of the run announcing it.
 *
 * Examples: "0.1.5.3" → "0.1.5.3"; "0.1.5.3.artifact.0" → "0.1.5.3"; "foo.bar" → null.
 */
export function extractSeqPathPrefix(id: string): string | null {
	const match = id.match(/^-?\d+(?:\.-?\d+)*/);
	return match ? match[0] : null;
}

/**
 * The execution a run of one feature is: when the process began, and which feature of it this is. Two runs of the same
 * feature walk the same step paths, so a path alone does not name a step; this is what tells one run of it from
 * another, and what a reader coming back to a run reads by.
 */
/** The field every record of a run states its execution in. A record's id names its execution too, but a field is what
 *  a store can filter on, which is what lets a run be read, counted and spanned as one run rather than as whatever the
 *  store holds. */
export const EXECUTION_FIELD = "execution";

/** The field every record of a run states when it was recorded in, set as it is written and again whenever it is
 *  written again. A record is written after the moment it is of, so a reader following a run asks for what was
 *  recorded since their last read, which is exact, rather than for what is of a later moment, which a record written
 *  late is not. */
export const RECORDED_AT_TIME_FIELD = "recordedAtTime";

export function executionOf(tag: { key: string; featureNum: number }): string {
	return `${tag.key}-${tag.featureNum}`;
}

/**
 * What names a record of a run: the execution it belongs to, the step path within it, and, for what a step said or
 *  produced, which of those it is. One form, wherever a record is named, so reading a name is parsing rather than
 *  string surgery over several shapes.
 */
export const RecordNameSchema = z
	.object({
		/** When the process began and which feature of it this run is. */
		execution: z.string().regex(/^\d+--?\d+$/),
		/** The step within that execution, empty for what the run said outside every step. */
		path: z.array(z.number().int()),
		/** Which of the things one step said or produced this is; absent on the step's own record. */
		ordinal: z.number().int().nonnegative().optional(),
	})
	.strict();
export type TRecordName = z.infer<typeof RecordNameSchema>;

/** The id a record carries. */
export function formatRecordName(name: TRecordName): string {
	const under = [name.execution, ...name.path].join(".");
	return name.ordinal === undefined ? under : `${under}@${name.ordinal}`;
}

/** The record a name names, or undefined where the id names no record of a run. */
export function parseRecordName(id: string): TRecordName | undefined {
	const [under, ordinal] = id.split("@");
	const [execution, ...path] = under.split(".");
	const parsed = RecordNameSchema.safeParse({
		execution,
		path: path.map((p) => Number.parseInt(p, 10)),
		...(ordinal === undefined ? {} : { ordinal: Number.parseInt(ordinal, 10) }),
	});
	return parsed.success ? parsed.data : undefined;
}

/**
 * Total order on seqPath tuples by lexicographic segment compare. Shorter
 * prefixes precede their extensions, mirroring the depth-first dispatch
 * order used when seqPaths are assigned. Returns -1 / 0 / 1.
 */
export function compareSeqPath(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
	}
	if (a.length !== b.length) return a.length < b.length ? -1 : 1;
	return 0;
}

/** SeqPath individual field names, single source of truth shared by schema, topology, and emission. */
export const SEQ_PATH_FIELD = {
	id: "id",
	stepText: "stepText",
	/** What the step called: the stepper and the action within it, as `Stepper.action`. The step's TEXT says what was asked for; this says what ran. */
	called: "called",
	actionStatus: "actionStatus",
	/** Why a step failed, written only where one did: what went wrong is a fact about the step, so it is on the step. */
	error: "error",
	/** The view this step showed, by the name the site declares it under. How that view looks is the site's
	 *  declaration, so a record says which view rather than carrying a copy of what the declaration already says. */
	showed: "showed",
	/** The capability this step declares, written only where it declares one: what had to be held to run it. */
	capabilityAction: "capabilityAction",
	/** What the caller held that allowed it. The actions of the grant, never the token: a bearer token is the
	 *  credential itself, and a record of it would be a copy of the credential. */
	allowedAction: "allowedAction",
	generatedAtTime: "generatedAtTime",
	endedAtTime: "endedAtTime",
	path: "path",
	/** How the statement's outcome is to be taken. A speculative step's failure is expected, so a reader looking for
	 *  what went wrong wants the authoritative ones, and that is a distinction they can draw only if each step
	 *  says which it was. Written for every step, the ordinary case included, since "not speculative" is only
	 *  answerable when an authoritative step says so too. */
	mode: "mode",
	/** How the step reached what ran it: in this process, in another host, or in a subprocess. Where a step ran is a
	 *  fact about that step, so it is written on it rather than traced beside it. */
	ranVia: "ranVia",
	/** The host that ran it, where another one did. */
	ranOn: "ranOn",
	/** How prominently the step reports: a run's own steps at `info`, a call made into a running instance at `trace`.
	 *  Written on the record because a reader filtering by level filters records, and a page's own calls are steps the
	 *  run records exactly like any other. */
	level: "level",
	/** The run this step belongs to. Written by every writer; a record without one was written before the field was
	 *  declared, and is part of no run a reader can ask for by name. */
	execution: EXECUTION_FIELD,
	/** When this record was written, and written again at the step's end. */
	recordedAtTime: RECORDED_AT_TIME_FIELD,
} as const;

/** SeqPath edge names. */
export const SEQ_PATH_EDGE = {
	isPartOf: "isPartOf",
	precededBy: "precededBy",
	/** The principal whose capability allowed this step, where one did. An actor edge, so a sequence reads the step on
	 *  that principal's lifeline rather than as something that merely mentions it. */
	performedBy: "performedBy",
} as const;

const STATUS_VALUES = Object.values(SEQ_PATH_STATUS) as [string, ...string[]];

// Non-strict: emitSeqPathStart writes isPartOf/precededBy into the same
// upsert as the individual properties (declared as edges in topology, but
// inlined for the start record). Strict mode would reject those keys
// before upsertIndividual can route them, same passthrough constraint as
// CommentSchema and BodySchema.
export const SeqPathSchema = z.object({
	[SEQ_PATH_FIELD.id]: z.string(),
	[SEQ_PATH_FIELD.stepText]: z.string(),
	[SEQ_PATH_FIELD.called]: z.string().optional(),
	[SEQ_PATH_FIELD.actionStatus]: z.enum(STATUS_VALUES),
	[SEQ_PATH_FIELD.error]: z.string().optional(),
	[SEQ_PATH_FIELD.showed]: z.string().optional(),
	[SEQ_PATH_FIELD.capabilityAction]: z.string().optional(),
	accessLevel: AccessLevelSchema.optional(),
	[SEQ_PATH_FIELD.allowedAction]: z.string().optional(),
	[SEQ_PATH_FIELD.generatedAtTime]: z.string(),
	[SEQ_PATH_FIELD.endedAtTime]: z.string().optional(),
	[SEQ_PATH_FIELD.path]: z.string().optional(),
	[SEQ_PATH_FIELD.mode]: z.enum(EXECUTION_MODES).optional(),
	[SEQ_PATH_FIELD.ranVia]: z.enum(["local", "remote", "subprocess"]).optional(),
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
		"A step in an automated run: what it asked for, what it called, and how it ended. Records made during that step point back here, so you can see exactly when and where something was produced.",
	topology: {
		persistedAs: SEQ_PATH_LABEL,
		id: SEQ_PATH_FIELD.id,
		properties: {
			[SEQ_PATH_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			[SEQ_PATH_FIELD.stepText]: LinkRelations.CONTENT.rel,
			[SEQ_PATH_FIELD.called]: LinkRelations.CALLED.rel,
			[SEQ_PATH_FIELD.actionStatus]: LinkRelations.ACTION_STATUS.rel,
			[SEQ_PATH_FIELD.error]: LinkRelations.CONTENT.rel,
			// Grouped-as, so "the steps that showed the graph" is a filter the type offers.
			[SEQ_PATH_FIELD.showed]: LinkRelations.CONTEXT.rel,
			[SEQ_PATH_FIELD.capabilityAction]: LinkRelations.CAPABILITY_ACTION.rel,
			accessLevel: LinkRelations.ACCESS_LEVEL.rel,
			[SEQ_PATH_FIELD.allowedAction]: LinkRelations.ALLOWED_ACTION.rel,
			[SEQ_PATH_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[SEQ_PATH_FIELD.endedAtTime]: LinkRelations.ENDED_AT_TIME.rel,
			[SEQ_PATH_FIELD.path]: LinkRelations.SOURCE_PATH.rel,
			// Grouped-as, which is what makes it one of the sub-filters offered beside the type rather than a field a
			// reader has to type a condition for.
			[SEQ_PATH_FIELD.mode]: LinkRelations.CONTEXT.rel,
			// Grouped-as as well, so "the steps another host ran" is a filter the type offers rather than a condition to write.
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
		// The step's end beside its start, as a moment a store orders by; and when the record was written, which a
		// reader following the run asks for what happened since their last read by.
		sortColumns: { [SEQ_PATH_FIELD.endedAtTime]: "TIMESTAMPTZ", [SEQ_PATH_FIELD.recordedAtTime]: "TIMESTAMPTZ", [SEQ_PATH_FIELD.execution]: "TEXT" },
	},
};
