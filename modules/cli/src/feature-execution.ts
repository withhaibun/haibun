/**
 * A FeatureExecution individual records one test run: its feature filter, the directory that holds the features, its
 * status, its counts and the path of its report.
 *
 * A finding about a test run references this record through `hasTarget`. A Comment about a test run doesn't have a
 * target without this record. A report would then name the test run in its text. A reader would match strings to find
 * the test run. The sequence view shows a finding beside the record it targets. A later test run of the same features
 * writes a second individual and doesn't overwrite the first. The graph then shows whether a change fixed a failure.
 *
 * A test run is attributed to the principal that its call's boundary verified, so the graph shows who started it. A
 * test run started by a statement under `holding capability` is attributed to the principal the verifier returns, or
 * else to the capability's controller. A test run started during one agent session is attributed to that session's
 * delegated subkey. A test run started without a verified principal is attributed to the test runner agent.
 *
 * `endpoint` holds the origin of a standing test run. A caller reads it from the record to probe the test run after its
 * features finish. A standing test run holds its port until it is stopped. TestRunnerStepper's RUN_STANDS option leaves
 * a test run standing. A standing test run requires a RUN_PORT above zero. RUN_PORT alone doesn't leave a test run
 * standing. A test run that isn't left standing doesn't have an endpoint. It ends when its features end.
 */
import { z } from "zod";
import { Access, COMMENT_LABEL, LinkRelations, PRINCIPAL_LABEL, type TDomainDefinition } from "@haibun/core/lib/resources.js";
import { RECORDED_STATUS } from "@haibun/core/schema/protocol.js";

export const FEATURE_EXECUTION_LABEL = "FeatureExecution";
export const FEATURE_EXECUTION_DOMAIN = "feature-execution";

/** A test run's status, as its record stores it: the recorded words of the status vocabulary, and `not started`. The exit
 *  code determines `running`, `passed` and `failed`. A standing test run's failed step count determines `passed` and
 *  `failed`. stopTestRun writes `stopped`. A start that failed is recorded as `not started`: the test run ended before its
 *  process ran, so it isn't `pending`, which marks work still to start, nor `failed`, which marks features that failed. */
export const RUN_STATUS = { ...RECORDED_STATUS, notStarted: "not started" } as const;
export type TRunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

const FeatureExecutionSchema = z.object({
	id: z.string(),
	/** The directory that holds the features, and the filter that selects which of them ran. */
	where: z.string(),
	filter: z.string(),
	status: z.enum(RUN_STATUS),
	/** Why a test run didn't start. Present only on a record whose status is `not started`. */
	why: z.string().optional(),
	/** The origin at which a standing test run responds. A caller probes the test run from this record alone. A test run
	 *  that isn't left standing doesn't have an endpoint, even with RUN_PORT set. */
	endpoint: z.string().optional(),
	startedAt: z.string(),
	endedAt: z.string().optional(),
	/** The path of the report a test run wrote. The record doesn't copy the report's contents. */
	report: z.string().optional(),
	/** Counts read from a test run's events: the features and steps it ran, and the steps that failed. */
	features: z.number().optional(),
	steps: z.number().optional(),
	failed: z.number().optional(),
	/** The first failed step, as its seqPath, its step text and its failure message. Absent when every step passed. */
	firstFailure: z.string().optional(),
	/** The principal that started a test run. It is the principal that the call's boundary verified, or the test runner
	 *  agent where the call didn't carry a verified principal. */
	attributedTo: z.string().optional(),
	/** The id of the Comment that holds the ask under which a test run started. Absent where the call didn't run under an
	 *  ask. */
	inReplyTo: z.string().optional(),
	/** The host id a standing test run takes. A caller addresses its steps as `on host {host}, <step>`. */
	host: z.number().optional(),
	generatedAtTime: z.string(),
	accessLevel: z.string().optional(),
});

export type TFeatureExecution = z.infer<typeof FeatureExecutionSchema>;

/** The FeatureExecution hypermedia domain. Its records are listed, linked and read as any other domain's records are. */
export const featureExecutionDomainDefinition: TDomainDefinition = {
	selectors: [FEATURE_EXECUTION_DOMAIN],
	schema: FeatureExecutionSchema,
	description: "One test run of named features: its feature filter, the endpoint of a standing test run, and its status. A finding about a test run targets this record.",
	topology: {
		persistedAs: FEATURE_EXECUTION_LABEL,
		accessLevel: Access.private,
		id: "id",
		displayLabel: "filter",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			where: LinkRelations.TAG.rel,
			filter: LinkRelations.NAME.rel,
			status: LinkRelations.OUTCOME_REASON.rel,
			endpoint: LinkRelations.TAG.rel,
			// Only generatedAtTime carries the GENERATED_AT_TIME rel, which holds the record's time. A second field with that rel
			// would give the record two times. startedAt and endedAt hold a test run's span as tags. Each has a sort column.
			startedAt: LinkRelations.TAG.rel,
			endedAt: LinkRelations.TAG.rel,
			report: LinkRelations.TAG.rel,
			features: LinkRelations.TAG.rel,
			steps: LinkRelations.TAG.rel,
			failed: LinkRelations.TAG.rel,
			firstFailure: LinkRelations.TAG.rel,
			why: LinkRelations.TAG.rel,
			host: LinkRelations.TAG.rel,
		},
		// Each queryable field needs a column for the store to query. A query selects a test run through these columns.
		sortColumns: { filter: "TEXT", status: "TEXT", startedAt: "TEXT", endedAt: "TEXT", where: "TEXT", endpoint: "TEXT", report: "TEXT" },
		// attributedTo and inReplyTo are edges with the types they range over, as every other attributed record declares
		// them. As plain properties they would name a principal or a Comment without an edge to follow. A test run would
		// then be absent from the lifeline of the principal that started it and from every view built from actors.
		edges: { attributedTo: { rel: LinkRelations.ATTRIBUTED_TO.rel, range: PRINCIPAL_LABEL }, inReplyTo: { rel: LinkRelations.IN_REPLY_TO.rel, range: COMMENT_LABEL } },
	},
};

/** The status a test run's exit code determines. A null code means its process is still running. */
export const statusOfExit = (exitCode: number | null): TRunStatus => (exitCode === null ? RUN_STATUS.running : exitCode === 0 ? RUN_STATUS.completed : RUN_STATUS.failed);
