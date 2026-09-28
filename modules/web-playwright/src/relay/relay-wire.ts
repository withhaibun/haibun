/**
 * The browser relay's wire contract, shared by the instance's `relay.*` family and the extension's channel: the calls,
 * the message that opens an attachment, and the messages between the relay and the extension.
 */
import { z } from "zod";

export const RELAY_METHOD_PREFIX = "relay.";

/** The relay's calls: `attach` is held open as a streamed call carrying the relay's commands, and `send` carries the
 *  extension's answers and events. Each is posted as `relay.{call}`. */
export type TRelayCall = "attach" | "send";

/** The first message of an attachment's stream: the relay holds the extension, so the extension may begin. A refused
 *  attachment's stream carries its refusal instead. */
export const RELAY_ATTACHED = "relay.attached";

/** How long the relay has to state it holds the extension, from the start of the attach call. An attach it doesn't
 *  open within this is refused, so the extension states why rather than waiting on a call that doesn't return. */
export const RELAY_OPEN_MS = 10_000;

/** A message between the relay and the attached extension: a command for it, or its answer, or a chrome event. */
const RelayMessageSchema = z.object({
	id: z.number().optional(),
	method: z.string().optional(),
	params: z.unknown().optional(),
	result: z.unknown().optional(),
	error: z.string().optional(),
});
export type TRelayMessage = z.infer<typeof RelayMessageSchema>;

/** What `relay.send` carries: the extension's messages, in the order it sent them. */
export const RelayBatchSchema = z.object({ messages: z.array(RelayMessageSchema) });
export type TRelayBatch = z.infer<typeof RelayBatchSchema>;

/** The domain of what the relay holds. */
export const DOMAIN_RELAY_ATTACHMENT = "relay-attachment";
/** What the relay holds: whether a person's browser is attached, the key that attached it, and its tabs. */
export const RelayAttachmentSchema = z.object({
	attached: z.boolean().describe("Whether a browser is attached."),
	holder: z.string().optional().describe("The key that attached it, where it proved one."),
	tabs: z
		.array(z.object({ id: z.number(), title: z.string().optional(), url: z.string().optional(), attached: z.boolean().describe("Whether the run drives the tab.") }))
		.describe("The tabs the extension reported."),
});
export type TRelayAttachment = z.infer<typeof RelayAttachmentSchema>;
