/**
 * Artifact: something a run produced, as a graph individual.
 *
 * A screenshot, a recording, a page's HTML, a trace of a call: what a step produced beside its own outcome. The record
 * carries where it is and what it is rather than what it holds, since an artifact is usually already a file and a
 * record of it is a pointer to that file. It points back at the step that produced it, so what a run produced is read
 * the same way as what a run did.
 */
import { z } from "zod";
import { HAIBUN_LOG_LEVELS } from "../schema/protocol.js";
import { EXECUTION_FIELD, RECORDED_AT_TIME_FIELD } from "./seq-path.js";
import { AccessLevelSchema, LinkRelations, SEQ_PATH_LABEL, type TDomainDefinition } from "./resources.js";

export const RUN_ARTIFACT_DOMAIN = "run-artifact";
export const RUN_ARTIFACT_LABEL = "Artifact";

/** Artifact field names, shared by the schema, the topology and whatever writes one. */
export const RUN_ARTIFACT_FIELD = {
	id: "id",
	/** What kind of thing it is, as the run named it: an image, a recording, a trace. */
	artifactType: "artifactType",
	/** Where it is, as the run serves it. */
	path: "path",
	/** Where it is relative to the feature's own directory, which is how a saved record of the run reaches it. */
	featureRelativePath: "featureRelativePath",
	mediaType: "mediaType",
	/** How prominently it reports: what a run produced as its work is shown where its steps are, a trace of the run's
	 *  own machinery under them. */
	level: "level",
	generatedAtTime: "generatedAtTime",
	/** The run that produced it. */
	execution: EXECUTION_FIELD,
	/** When this record was written. */
	recordedAtTime: RECORDED_AT_TIME_FIELD,
} as const;

/** Artifact edge names. */
export const RUN_ARTIFACT_EDGE = {
	/** The step that produced it. */
	isPartOf: "isPartOf",
} as const;

// Non-strict for the same reason as SeqPath: `isPartOf` is declared as an edge and written in the same upsert.
export const RunArtifactSchema = z.object({
	[RUN_ARTIFACT_FIELD.id]: z.string(),
	[RUN_ARTIFACT_FIELD.artifactType]: z.string(),
	[RUN_ARTIFACT_FIELD.path]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.featureRelativePath]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.mediaType]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.level]: z.enum(HAIBUN_LOG_LEVELS),
	[RUN_ARTIFACT_FIELD.generatedAtTime]: z.string(),
	[RUN_ARTIFACT_FIELD.execution]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.recordedAtTime]: z.string().optional(),
	accessLevel: AccessLevelSchema.optional(),
});
export type TRunArtifact = z.infer<typeof RunArtifactSchema>;

export const runArtifactDomainDefinition: TDomainDefinition = {
	selectors: [RUN_ARTIFACT_DOMAIN],
	schema: RunArtifactSchema,
	description:
		"Something a run produced beside a step's outcome: an image, a recording, a page, a trace. The record says where it is and what it is; it points back at the step that produced it.",
	topology: {
		persistedAs: RUN_ARTIFACT_LABEL,
		id: RUN_ARTIFACT_FIELD.id,
		// A reader is told a run produced something by the run producing it. This record is the durable copy of that.
		announceWrites: false,
		properties: {
			[RUN_ARTIFACT_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			// Grouped-as, so "the images this run produced" is a filter the type offers rather than a condition to write.
			[RUN_ARTIFACT_FIELD.artifactType]: LinkRelations.CONTEXT.rel,
			[RUN_ARTIFACT_FIELD.path]: LinkRelations.SOURCE_PATH.rel,
			[RUN_ARTIFACT_FIELD.featureRelativePath]: LinkRelations.SOURCE_PATH.rel,
			[RUN_ARTIFACT_FIELD.mediaType]: LinkRelations.MEDIA_TYPE.rel,
			[RUN_ARTIFACT_FIELD.level]: LinkRelations.CONTEXT.rel,
			[RUN_ARTIFACT_FIELD.execution]: LinkRelations.CONTEXT.rel,
			[RUN_ARTIFACT_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[RUN_ARTIFACT_FIELD.recordedAtTime]: LinkRelations.RECORDED_AT_TIME.rel,
			accessLevel: LinkRelations.ACCESS_LEVEL.rel,
		},
		edges: {
			[RUN_ARTIFACT_EDGE.isPartOf]: { rel: LinkRelations.PART_OF.rel, range: SEQ_PATH_LABEL },
		},
		sortColumns: { [RUN_ARTIFACT_FIELD.recordedAtTime]: "TIMESTAMPTZ", [RUN_ARTIFACT_FIELD.execution]: "TEXT" },
	},
};
