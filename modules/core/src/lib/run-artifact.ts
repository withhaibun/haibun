/**
 * Artifact: a graph individual for something a step of actuality produced beside its own outcome.
 *
 * An artifact can be a screenshot, a recording, a page's HTML or a trace of a call. The record holds the artifact's
 * location and kind, and doesn't hold its content. An artifact is usually already a file, so its record references that
 * file. The record references the step that produced it, so actuality's artifacts are read the same way as its steps.
 */
import { z } from "zod";
import { HAIBUN_LOG_LEVELS } from "../schema/protocol.js";
import { EXECUTION_FIELD, RECORDED_AT_TIME_FIELD } from "./seq-path.js";
import { Access, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "./resources.js";

const RUN_ARTIFACT_DOMAIN = "run-artifact";

/** The route under which actuality serves the artifacts its steps captured. */
export const ARTIFACTS_ROUTE = "/artifacts";

/** Returns the address of the artifact at `path` under ARTIFACTS_ROUTE. */
export const artifactAddress = (path: string): string => `${ARTIFACTS_ROUTE}/${path}`;
export const RUN_ARTIFACT_LABEL = "Artifact";

/** Artifact field names. The schema, the topology and each writer of an artifact read them. */
export const RUN_ARTIFACT_FIELD = {
	id: "id",
	/** The artifact's kind as actuality names it, such as an image, a recording or a trace. */
	artifactType: "artifactType",
	/** The path under which actuality serves it. */
	path: "path",
	/** Its path relative to the feature's directory. A saved record of actuality references the artifact by this path. */
	featureRelativePath: "featureRelativePath",
	mediaType: "mediaType",
	/** The artifact's log level. An artifact of actuality's work has the level of its steps. A trace of actuality's
	 *  internal operations has a lower level. */
	level: "level",
	generatedAtTime: "generatedAtTime",
	/** The execution that produced it. */
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
const RunArtifactSchema = PersistedVertexSchema.extend({
	[RUN_ARTIFACT_FIELD.id]: z.string(),
	[RUN_ARTIFACT_FIELD.artifactType]: z.string(),
	[RUN_ARTIFACT_FIELD.path]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.featureRelativePath]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.mediaType]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.level]: z.enum(HAIBUN_LOG_LEVELS),
	[RUN_ARTIFACT_FIELD.generatedAtTime]: z.string(),
	[RUN_ARTIFACT_FIELD.execution]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.recordedAtTime]: z.string().optional(),
});
/** An artifact as a reader names and finds it: its kind, the path under which actuality serves it, and its path relative to
 *  the feature's directory, by which a saved record of actuality references it. */
export type TArtifactLine = { kind: string; path?: string; besideFeature?: string };

/** The fields an artifact's record and the artifact event it copies both hold. */
const ArtifactFieldsSchema = z.object({
	[RUN_ARTIFACT_FIELD.artifactType]: z.string(),
	[RUN_ARTIFACT_FIELD.path]: z.string().optional(),
	[RUN_ARTIFACT_FIELD.featureRelativePath]: z.string().optional(),
});

/** Returns an artifact's line, from its record or from the artifact event its record copies. Throws for an object that
 *  doesn't state an artifact's kind. */
export function artifactOf(artifact: Record<string, unknown>): TArtifactLine {
	const fields = ArtifactFieldsSchema.parse(artifact);
	const path = fields[RUN_ARTIFACT_FIELD.path];
	const besideFeature = fields[RUN_ARTIFACT_FIELD.featureRelativePath];
	return { kind: fields[RUN_ARTIFACT_FIELD.artifactType], ...(path === undefined ? {} : { path }), ...(besideFeature === undefined ? {} : { besideFeature }) };
}

export const runArtifactDomainDefinition: TDomainDefinition = {
	selectors: [RUN_ARTIFACT_DOMAIN],
	schema: RunArtifactSchema,
	description:
		"Something a step of actuality produced beside its outcome, such as an image, a recording, a page or a trace. The record states where the artifact is and what kind it is. It references the step that produced it.",
	topology: {
		persistedAs: RUN_ARTIFACT_LABEL,
		accessLevel: Access.private,
		id: RUN_ARTIFACT_FIELD.id,
		instrumentation: true,
		// A reader receives an artifact as the artifact event a step emits. This record is the durable copy of that event, so
		// announcing the write would report the artifact a second time.
		announceWrites: false,
		properties: {
			[RUN_ARTIFACT_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			// The type offers each artifact type as a filter because this field is `groupedAs`. A reader doesn't write a condition for it.
			[RUN_ARTIFACT_FIELD.artifactType]: LinkRelations.CONTEXT.rel,
			[RUN_ARTIFACT_FIELD.path]: LinkRelations.SOURCE_PATH.rel,
			[RUN_ARTIFACT_FIELD.featureRelativePath]: LinkRelations.SOURCE_PATH.rel,
			[RUN_ARTIFACT_FIELD.mediaType]: LinkRelations.MEDIA_TYPE.rel,
			[RUN_ARTIFACT_FIELD.level]: LinkRelations.CONTEXT.rel,
			[RUN_ARTIFACT_FIELD.execution]: LinkRelations.CONTEXT.rel,
			[RUN_ARTIFACT_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[RUN_ARTIFACT_FIELD.recordedAtTime]: LinkRelations.RECORDED_AT_TIME.rel,
		},
		edges: { [RUN_ARTIFACT_EDGE.isPartOf]: { rel: LinkRelations.PART_OF.rel, range: SEQ_PATH_LABEL } },
		sortColumns: { [RUN_ARTIFACT_FIELD.recordedAtTime]: "TIMESTAMPTZ", [RUN_ARTIFACT_FIELD.execution]: "TEXT" },
	},
};
