/**
 * LogMessage: what a run said, as a graph individual.
 *
 * A step writes itself as a SeqPath individual; what it said while it ran is written here, under the same seqPath it
 * happened during. So one query over these and the SeqPath individuals is the run, ordered by time and filtered by
 * level, and there is no second record of it to keep in step.
 *
 * The level is declared as context, which is what makes it one of the filters offered beside the type rather than a
 * condition a reader has to write.
 */
import { z } from "zod";
import { HAIBUN_LOG_LEVELS } from "../schema/protocol.js";
import { EXECUTION_FIELD } from "./seq-path.js";
import { AccessLevelSchema, LinkRelations, SEQ_PATH_LABEL, type TDomainDefinition } from "./resources.js";

export const LOG_MESSAGE_DOMAIN = "log-message";
export const LOG_MESSAGE_LABEL = "LogMessage";

/** LogMessage field names, shared by the schema, the topology and whatever writes one. */
export const LOG_MESSAGE_FIELD = {
	id: "id",
	message: "message",
	level: "level",
	generatedAtTime: "generatedAtTime",
	/** The run this was said during. */
	execution: EXECUTION_FIELD,
} as const;

/** LogMessage edge names. */
export const LOG_MESSAGE_EDGE = {
	/** The step this was said during. */
	isPartOf: "isPartOf",
} as const;

// Non-strict for the same reason as SeqPath: `isPartOf` is declared as an edge but written in the same upsert as the
// properties, and strict mode would reject it before the write can route it.
export const LogMessageSchema = z.object({
	[LOG_MESSAGE_FIELD.id]: z.string(),
	[LOG_MESSAGE_FIELD.message]: z.string(),
	[LOG_MESSAGE_FIELD.level]: z.enum(HAIBUN_LOG_LEVELS),
	[LOG_MESSAGE_FIELD.generatedAtTime]: z.string(),
	[LOG_MESSAGE_FIELD.execution]: z.string().optional(),
	accessLevel: AccessLevelSchema.optional(),
});
export type TLogMessage = z.infer<typeof LogMessageSchema>;

export const logMessageDomainDefinition: TDomainDefinition = {
	selectors: [LOG_MESSAGE_DOMAIN],
	schema: LogMessageSchema,
	description: "Something a run said while a step was running: its text, how serious it was, and when. It points back at the step it was said during.",
	topology: {
		persistedAs: LOG_MESSAGE_LABEL,
		id: LOG_MESSAGE_FIELD.id,
		// A reader is told a run said something by the run saying it. This record is the durable copy of that statement,
		// so announcing the write would say it a second time, once per field.
		announceWrites: false,
		properties: {
			[LOG_MESSAGE_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			[LOG_MESSAGE_FIELD.message]: LinkRelations.CONTENT.rel,
			[LOG_MESSAGE_FIELD.level]: LinkRelations.CONTEXT.rel,
			[LOG_MESSAGE_FIELD.execution]: LinkRelations.CONTEXT.rel,
			[LOG_MESSAGE_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			accessLevel: LinkRelations.ACCESS_LEVEL.rel,
		},
		edges: {
			[LOG_MESSAGE_EDGE.isPartOf]: { rel: LinkRelations.PART_OF.rel, range: SEQ_PATH_LABEL },
		},
	},
};
