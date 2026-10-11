/**
 * conversation: the contract of a conversation with a model, beside taiwa's. A conversation stepper declares its steps with
 * these domains, so a client finds each step by what it takes and returns rather than by the stepper's method names: the
 * step that takes a question and returns a response sends a turn, and the steps that return a session, the sessions, a
 * turn's key and a question's file read and keep them. The step that sends a turn names its parameters by `ASK_PARAM`.
 * The type of a stepper's models states itself a kind of `CONVERSATION_MODEL_CLASS`, and each of its records offers a
 * client what `ConversationModelSchema` reads.
 */
import { z } from "zod";
import { CountedFields } from "../../hypermedia.js";
import { SearchConditionSchema, type TSearchCondition } from "../../quad-types.js";
import { DENOTES, IndividualAddressSchema } from "../../typed-links.js";
import type { TDomainDefinition } from "../../resources.js";

/** The domains of a conversation's steps. */
export const CONVERSATION_DOMAIN = {
	/** What a turn sends beside its words: the envelope of its records, view, session and delegation. */
	QUESTION: "conversation-question",
	/** A model's response, which a turn streams. */
	RESPONSE: "conversation-response",
	/** A session's turns, read back. */
	SESSION: "conversation-session",
	/** The sessions a store holds. */
	SESSIONS: "conversation-sessions",
	/** A key made for one turn, and what a turn takes beyond its read. */
	TURN_KEY: "conversation-turn-key",
	/** The record a file a person adds to a question is kept as. */
	FILE: "conversation-file",
} as const;

/** The parameters of the step that sends a turn: the model, the read level of its records, the words, and the question. */
export const ASK_PARAM = { model: "target", readLevel: "accessLevel", prompt: "prompt", question: "context" } as const;
/** The parameter of the step that reads a session: the session, named by its first question's record. */
export const SESSION_PARAM = "session";
/** The parameters of the step that keeps a question's file: its bytes as a data: URL, and its name. */
export const FILE_PARAM = { file: "file", name: "name" } as const;

/** The class that the type of a conversation stepper's models states itself a kind of: a client finds that type by it. */
export const CONVERSATION_MODEL_CLASS = "hbn:ConversationModel";

/** Who reads a turn's records: actuality, which sends them, or the model, which is sent the calls that read them. */
export const ContextReadBySchema = z.enum(["run", "model"]);

/** A model as an ask lists it: what the endpoint reports it can do, whether it is the standing default, and what its
 *  profile states. A model's record holds more, which an ask doesn't read. */
export const ConversationModelSchema = z.looseObject({
	id: z.string(),
	displayName: z.string().optional(),
	capabilities: z.looseObject({ tools: z.boolean().optional(), thinking: z.boolean().optional() }).optional(),
	/** Whether this is the standing default, the model that receives a call outside any turn. */
	standing: z.boolean().optional(),
	options: z.looseObject({ contextReadBy: ContextReadBySchema.optional() }).optional(),
});
export type TConversationModel = z.infer<typeof ConversationModelSchema>;

/** A provider that groups a model type's records, as discovery recorded it: whether it responded, how many models it
 *  listed, and why it didn't respond. */
export const ConversationProviderSchema = z.looseObject({ id: z.string(), answered: z.boolean(), models: z.number(), why: z.string().optional() });
export type TConversationProvider = z.infer<typeof ConversationProviderSchema>;

/** What a reader reads of a turn whose response states records the turn was not sent, before the handles it names. */
export const UNVERIFIED_TURN = "the turn stated records it was not sent";
/** The status of an asked turn. */
export const ChatStatusSchema = z.enum(["asking", "running", "completed", "failed", "stopped", "unverified"]);
export type TChatStatus = z.infer<typeof ChatStatusSchema>;

/**
 * An individual is named by the type it is persisted as and its own id, the pair every surface names one by, so
 * whoever resolves it reads it directly. A type names its members, narrowed by the conditions given. `kind` separates
 * the two in the words core already names them by, so a surface holding only a type can't state more.
 */
const ContextIndividualSchema = IndividualAddressSchema.extend({ kind: z.literal(DENOTES.individual) });
const ContextTypeSchema = z.object({
	kind: z.literal(DENOTES.type),
	persistedAs: z.string().describe("The type whose members the question concerns."),
	conditions: z.array(SearchConditionSchema).describe("What every member must match, in the same conditions the query surface and the store take."),
});
export const ContextPatternSchema = z.discriminatedUnion("kind", [ContextIndividualSchema, ContextTypeSchema]);
export type TContextIndividual = z.infer<typeof ContextIndividualSchema>;
export type TContextPattern = z.infer<typeof ContextPatternSchema>;
export const ContextQuerySchema = z.array(ContextPatternSchema);

/** The ask is about one individual. */
export const anIndividual = (persistedAs: string, id: string): TContextIndividual => ({ kind: DENOTES.individual, persistedAs, id });

/** The ask is about a type: its members, narrowed by whichever conditions carry both a field and a value. The conditions
 *  travel as they were stated, so an operator the reader chose reaches the store that reads it. */
export const aType = (persistedAs: string, conditions: readonly TSearchCondition[]): TContextPattern => ({
	kind: DENOTES.type,
	persistedAs,
	conditions: conditions.filter((c) => c.predicate && c.value),
});

/**
 * A turn of a session as the store reads it back. A turn is named by its question's record, which is what a page reads
 * actuality recorded, so a page addresses a turn, the turn it replies to and its session without a stepper's own names.
 */
const SessionTurnSchema = z
	.object({
		prompt: z.string().describe("What the reader asked."),
		response: z.string().describe("The model's response; empty before the model responded."),
		askId: z.string().describe("The question's record, which names the turn."),
		sayId: z.string().optional().describe("The response's record, once there is one."),
		inReplyTo: z.string().optional().describe("The question record of the turn this one replies to; unset for a session's first turn."),
		bundle: ContextQuerySchema.describe("The records the question referenced, which a page makes active again when a reader selects the turn."),
		generatedAtTime: z.string().describe("When the question was sent. This orders the turns, and a view shows the turns sent at or before the place its reader holds."),
		status: ChatStatusSchema.describe(
			"How the turn stands: running, completed, failed, stopped by its reader, or unverified, which is a turn that stated a handle its records don't hold.",
		),
		unverified: z.array(z.string()).optional().describe("The handles an unverified turn's response states that its records don't hold."),
		error: z.string().optional().describe("What the step failed with, where it failed."),
	})
	.strict();
export type TSessionTurn = z.infer<typeof SessionTurnSchema>;
/** A session's turns as the store reads them back, in the order they were sent, so the last is the latest. A step's
 *  products carry the step that produced them beside what the step declares, so the read is not strict; each turn is. */
export const SessionReadSchema = z.object({ turns: z.array(SessionTurnSchema) });
/** The sessions the store holds, each named by its first question's record, newest first, with the count of sessions to
 *  the ceiling. */
export const SessionListSchema = z.object({
	...CountedFields,
	sessions: z.array(
		z
			.object({
				session: z.string().describe("The question record that names the session."),
				label: z.string().describe("What the session is called: what its first question asked."),
				generatedAtTime: z.string().describe("When its newest turn was sent. A page lists the sessions by this, most recent first."),
				turns: z.number().int().nonnegative().describe("How many turns the session holds. A page compares this with the count it read when the reader last opened the session."),
			})
			.strict(),
	),
});
export type TSessionList = z.infer<typeof SessionListSchema>;

/** What a turn sends beside its words: the patterns of the records it is about, the page's view, how many calls its model
 *  may chain, who reads the records, and the session and turn it replies in, each named by a question record. Strict, so a
 *  key a sender renamed is refused rather than dropped. */
export const TurnEnvelopeSchema = z
	.object({
		patterns: ContextQuerySchema,
		viewLd: z.array(z.record(z.string(), z.unknown())),
		maxToolCalls: z.number().int().min(0).max(99).optional(),
		contextReadBy: ContextReadBySchema.optional(),
		session: z.string().optional(),
		inReplyTo: z.string().optional(),
		/** The delegation the asker signed to the turn's key: what the turn may do, which an ask from a key carries. */
		delegation: z.record(z.string(), z.unknown()).optional(),
	})
	.strict()
	.refine((envelope) => envelope.inReplyTo === undefined || envelope.session !== undefined, { message: "a reply names the session it replies in", path: ["session"] });
export type TTurnEnvelope = z.input<typeof TurnEnvelopeSchema>;

/** A model's response: the whole text, which a streaming caller also receives as a sequence of chunks. */
export const ResponseSchema = z.object({ text: z.string().describe("The whole text the model produced.") });

/** A key made for one turn: its did:key, when a delegation to it must end, and the actions a turn takes beyond its read. */
export const TurnKeySchema = z.object({ controller: z.string(), expires: z.string(), actions: z.array(z.string()) });

/** The record a file a person adds to a question is kept as, which the stepper that keeps files registers. */
export const questionFileDomainDefinition: TDomainDefinition = {
	selectors: [CONVERSATION_DOMAIN.FILE],
	schema: IndividualAddressSchema,
	description: "The record a file a person adds to a question is kept as",
};

/** The domains a conversation stepper registers beside its question, whose schema the stepper states, since it reads the
 *  question from the line that sends the turn. */
export const conversationDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [CONVERSATION_DOMAIN.RESPONSE], schema: ResponseSchema, description: "A model's response" },
	{ selectors: [CONVERSATION_DOMAIN.SESSION], schema: SessionReadSchema, description: "The turns of a conversation's session" },
	{ selectors: [CONVERSATION_DOMAIN.SESSIONS], schema: SessionListSchema, description: "The sessions of conversations a store holds" },
	{ selectors: [CONVERSATION_DOMAIN.TURN_KEY], schema: TurnKeySchema, description: "A key made for one turn, and what a turn takes beyond its read" },
	questionFileDomainDefinition,
];
