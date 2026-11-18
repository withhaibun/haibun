/**
 * The status words of an asked turn: the status vocabulary's running and ended words, with the words a turn holds beside them.
 * A page reads a turn's status without the schemas of a session.
 */
import { z } from "zod";
import { STATUS } from "../../domains/protocol.js";

/** What a reader reads of a turn whose response states records the turn was not sent, before the handles it names. */
export const UNVERIFIED_TURN = "the turn stated records it was not sent";
/** The words a turn holds beside the status vocabulary. `asking` marks a turn whose question the page sent before actuality
 *  recorded it, and `unverified` a turn that completed with a response stating handles its records don't hold. Each is a
 *  turn's own state that the vocabulary's words don't name, and the transcript writes it on `data-status`. */
export const TURN_STATUS = { asking: "asking", unverified: "unverified" } as const;
/** The status of an asked turn: the vocabulary's running and ended words, with the turn's own words. */
export const ChatStatusSchema = z.enum([TURN_STATUS.asking, STATUS.running, STATUS.completed, STATUS.failed, STATUS.stopped, TURN_STATUS.unverified]);
export type TChatStatus = z.infer<typeof ChatStatusSchema>;
