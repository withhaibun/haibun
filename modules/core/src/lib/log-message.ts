/**
 * A LogMessage individual holds one message that actuality logged.
 *
 * A step writes itself as a SeqPath individual. Each message the step logs is written as a LogMessage that references
 * that step's SeqPath through `isPartOf`. One query over LogMessage and SeqPath individuals returns actuality's record.
 * The query orders it by time and filters it by level. Actuality doesn't hold a second record that has to stay
 * consistent with this one.
 *
 * The topology declares the level with the context rel. A view offers each context field as a filter beside the type, so a
 * reader doesn't write a condition for the level.
 */
import { z } from "zod";
import { HAIBUN_LOG_LEVELS } from "../schema/protocol.js";
import { EXECUTION_FIELD, RECORDED_AT_TIME_FIELD } from "./seq-path.js";
import { LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "./resources.js";

const LOG_MESSAGE_DOMAIN = "log-message";
export const LOG_MESSAGE_LABEL = "LogMessage";

/** LogMessage field names. The schema, the topology and each writer of a LogMessage read them. */
export const LOG_MESSAGE_FIELD = {
	id: "id",
	message: "message",
	level: "level",
	generatedAtTime: "generatedAtTime",
	/** The id of the feature execution that logged this message. */
	execution: EXECUTION_FIELD,
	/** When this record was written. */
	recordedAtTime: RECORDED_AT_TIME_FIELD,
} as const;

/** LogMessage edge names. */
export const LOG_MESSAGE_EDGE = {
	/** The SeqPath of the step that logged this message. */
	isPartOf: "isPartOf",
} as const;

// Non-strict for the same reason as SeqPathSchema. `isPartOf` is declared as an edge, and the writer sends it in the same
// upsert as the properties. A strict schema would reject `isPartOf` before upsertIndividual routes it to an edge.
const LogMessageSchema = PersistedVertexSchema.extend({
	[LOG_MESSAGE_FIELD.id]: z.string(),
	[LOG_MESSAGE_FIELD.message]: z.string(),
	[LOG_MESSAGE_FIELD.level]: z.enum(HAIBUN_LOG_LEVELS),
	[LOG_MESSAGE_FIELD.generatedAtTime]: z.string(),
	[LOG_MESSAGE_FIELD.execution]: z.string().optional(),
	[LOG_MESSAGE_FIELD.recordedAtTime]: z.string().optional(),
});
export const logMessageDomainDefinition: TDomainDefinition = {
	selectors: [LOG_MESSAGE_DOMAIN],
	schema: LogMessageSchema,
	description: "A message that actuality logged while a step ran. It holds the message text, its level and the time it was generated. It references the step that logged it.",
	topology: {
		persistedAs: LOG_MESSAGE_LABEL,
		id: LOG_MESSAGE_FIELD.id,
		instrumentation: true,
		// A reader receives a logged message as a log event. This record is the durable copy of that event, so announcing
		// the write would report the message a second time, once per field.
		announceWrites: false,
		properties: {
			[LOG_MESSAGE_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			[LOG_MESSAGE_FIELD.message]: LinkRelations.CONTENT.rel,
			[LOG_MESSAGE_FIELD.level]: LinkRelations.CONTEXT.rel,
			[LOG_MESSAGE_FIELD.execution]: LinkRelations.CONTEXT.rel,
			[LOG_MESSAGE_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[LOG_MESSAGE_FIELD.recordedAtTime]: LinkRelations.RECORDED_AT_TIME.rel,
		},
		edges: { [LOG_MESSAGE_EDGE.isPartOf]: { rel: LinkRelations.PART_OF.rel, range: SEQ_PATH_LABEL } },
		sortColumns: { [LOG_MESSAGE_FIELD.recordedAtTime]: "TIMESTAMPTZ", [LOG_MESSAGE_FIELD.execution]: "TEXT" },
	},
};
