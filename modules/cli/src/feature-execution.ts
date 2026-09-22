/**
 * A FEATURE EXECUTION as an individual: which features ran, where from, how it ended, and where to look.
 *
 * A finding is about something. Without a record for the run there is nothing for a Comment to point at, so a report
 * would have to name the run in its text and a reader would have to match strings. With a record, a finding's
 * `hasTarget` names the run, the sequence view shows the finding beside it, and a later run of the same features is a
 * second individual rather than an overwrite, which is what makes "did the change fix it" answerable from the graph.
 *
 * A run is attributed to the principal controlling the capability it ran under, so the graph answers who started it:
 * a site principal for a run started by a feature line, and a delegated subkey for a run started during one session
 * of one agent.
 *
 * The endpoint is how a run is probed once its features have finished: a run given a port is left standing, so that
 * port answers until it is stopped. It is a fact about the run, not a side channel. A run given no port has no
 * endpoint; it ran its features on the ports they declare and ended when they did.
 */
import { z } from "zod";
import { COMMENT_LABEL, LinkRelations, PRINCIPAL_LABEL, type TDomainDefinition } from "@haibun/core/lib/resources.js";

export const FEATURE_EXECUTION_LABEL = "FeatureExecution";
export const FEATURE_EXECUTION_DOMAIN = "feature-execution";

/** How a run stands: started and still going, or ended as its exit code reports, or stopped before it finished. */
export const RUN_STATUS = { running: "running", passed: "passed", failed: "failed", stopped: "stopped" } as const;
export type TRunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export const FeatureExecutionSchema = z.object({
	id: z.string(),
	/** The directory of features the run was started from, and the filter that chose which of them ran. */
	where: z.string(),
	filter: z.string(),
	status: z.enum([RUN_STATUS.running, RUN_STATUS.passed, RUN_STATUS.failed, RUN_STATUS.stopped]),
	/** Where the run answers while it stands, so probing it needs nothing but the run. Absent for a run left to its
	 *  own ports, which ends rather than standing. */
	endpoint: z.string().optional(),
	startedAt: z.string(),
	endedAt: z.string().optional(),
	/** The run's own report, as the run wrote it: a path, never a copy of its contents. */
	report: z.string().optional(),
	/** What the run did, from its own events: how many features and steps it ran, and how many steps failed. */
	features: z.number().optional(),
	steps: z.number().optional(),
	failed: z.number().optional(),
	/** The first step that failed, as the seqPath it failed at and what it said. Absent when nothing failed. */
	firstFailure: z.string().optional(),
	/** The principal that started the run, which is the controller of the capability it ran under. */
	attributedTo: z.string().optional(),
	/** The ask the run was started under, when a model started it: the id of that ask's Comment. */
	inReplyTo: z.string().optional(),
	/** The host the run answers as while it stands, which is how its own steps are addressed. */
	host: z.number().optional(),
	generatedAtTime: z.string(),
	accessLevel: z.string().optional(),
});

export type TFeatureExecution = z.infer<typeof FeatureExecutionSchema>;

/** The run as a hypermedia domain: a record like any other, so it lists, links and reads with the rest. */
export const featureExecutionDomainDefinition: TDomainDefinition = {
	selectors: [FEATURE_EXECUTION_DOMAIN],
	schema: FeatureExecutionSchema,
	description: "One run of named features: what was run, where it answers while it stands, and how it ended. It is the record a finding about that run names.",
	topology: {
		persistedAs: FEATURE_EXECUTION_LABEL,
		id: "id",
		displayLabel: LinkRelations.NAME.rel,
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			where: LinkRelations.TAG.rel,
			filter: LinkRelations.NAME.rel,
			status: LinkRelations.OUTCOME_REASON.rel,
			endpoint: LinkRelations.TAG.rel,
			// One field carries the record's time (GENERATED_AT_TIME); a second declaring the same rel is two answers
			// to "when". The run's own start and end are its span, tagged and sorted on as themselves.
			startedAt: LinkRelations.TAG.rel,
			endedAt: LinkRelations.TAG.rel,
			report: LinkRelations.TAG.rel,
			features: LinkRelations.TAG.rel,
			steps: LinkRelations.TAG.rel,
			failed: LinkRelations.TAG.rel,
			firstFailure: LinkRelations.TAG.rel,
			host: LinkRelations.TAG.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
		},
		// Every queryable field needs a column to be queried through: a run is looked up by what ran, how it ended,
		// and when it started.
		sortColumns: { filter: "TEXT", status: "TEXT", startedAt: "TEXT", endedAt: "TEXT", where: "TEXT", endpoint: "TEXT", report: "TEXT" },
		// Who started it and what asked for it are EDGES, with the types they range over, as every other attributed
		// record declares them. Declared as plain properties they name a principal that nothing can be followed to, so
		// the run never stands on the lifeline of whoever started it and is missing from any reading built from actors.
		edges: {
			attributedTo: { rel: LinkRelations.ATTRIBUTED_TO.rel, range: PRINCIPAL_LABEL },
			inReplyTo: { rel: LinkRelations.IN_REPLY_TO.rel, range: COMMENT_LABEL },
		},
	},
};

/** What a run's exit code says about it. No code yet means it is still going. */
export const statusOfExit = (exitCode: number | null): TRunStatus => (exitCode === null ? RUN_STATUS.running : exitCode === 0 ? RUN_STATUS.passed : RUN_STATUS.failed);
