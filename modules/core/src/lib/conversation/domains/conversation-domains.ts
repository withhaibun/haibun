/**
 * The domains a conversation stepper registers, apart from the contract a page reads, so a page bundle doesn't carry their
 * declarations.
 */
import { z } from "zod";
import { listOf } from "../../domains/lists.js";
import { IndividualAddressSchema } from "../../domains/typed-links.js";
import type { TDomainDefinition } from "../../domains/resources.js";
import { CONVERSATION_DOMAIN, SessionListSchema, SessionReadSchema, TurnKeySchema } from "./conversation.js";

/** A model's response: the whole text, which a streaming caller also receives as a sequence of chunks. */
const ResponseSchema = z.object({ text: z.string().describe("The whole text the model produced.") });

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
	{
		selectors: [CONVERSATION_DOMAIN.SESSIONS],
		schema: SessionListSchema,
		list: listOf(SessionListSchema, "sessions", { time: "generatedAtTime" }),
		description: "The sessions of conversations a store holds",
	},
	{ selectors: [CONVERSATION_DOMAIN.TURN_KEY], schema: TurnKeySchema, description: "A key made for one turn, and what a turn takes beyond its read" },
	questionFileDomainDefinition,
];
