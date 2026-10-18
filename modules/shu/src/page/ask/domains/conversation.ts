/**
 * A conversation as the page holds it: the open session and the turn this page sends.
 *
 * A conversation is a session. A session groups turns under a first turn, and each turn's question record names the
 * turn. A conversation's status is closed, opening or open. It is opening while the store reads a session back. A first
 * question opens a conversation without a session. Actuality's record of that question then names the session.
 *
 * The page's turn has the status `asking` until actuality starts its step. Its status is then `running`. The request
 * stream carries the running turn's text, its status lines and the comments it records. The turn ends as completed,
 * failed or stopped. One turn of this page is in flight at a time, whatever conversation is open.
 */
import type { TRefusedCall } from "@haibun/core/lib/step-stream-context.js";
import type { TCalled } from "@haibun/core/lib/domains/called.js";
import { TURN_STATUS, type TChatStatus, type TContextPattern, type TSessionTurn } from "@haibun/core/lib/conversation/domains/conversation.js";
import { STATUS } from "@haibun/core/lib/domains/protocol.js";
import type { TRecord } from "../../../current-subject.js";

/** What a turn emitted while it ran. `progress` holds its latest status line, and its spinner shows that line.
 *  `context` holds the lines it sent, and `calls` holds the calls it made. */
export type TTurnStated = { progress: string; context: string[]; calls: TCalled[] };
export const NOTHING_STATED: TTurnStated = { progress: "", context: [], calls: [] };

/** A turn as the store reads it back or as this page sends it, with what it emitted while it ran. Its question's record
 *  names it. A turn this page sends has a null `askId` until actuality records its question. */
export type TTurn = Omit<TSessionTurn, "askId"> & { askId: string | null } & TTurnStated;

/** The turn this page sends. It adds the turn's session, the reason a reader gave to stop it, the actions the page
 *  delegated to it, and each refused action with the first call that needed it. The session is null for a first turn
 *  until actuality records its question. */
export type TAskedTurn = TTurn & { session: string | null; stoppedBy: string; delegated: string[]; refused: TRefusedCall[] };

export type TConversationState = {
	status: "closed" | "opening" | "open";
	session: string | null;
	turns: TTurn[];
	/** The turn this page sent last, in flight or ended. It is null before the page sends a turn. */
	asked: TAskedTurn | null;
};

export type TConversationEvent =
	| { type: "open"; session: string }
	| { type: "read"; session: string; turns: TSessionTurn[] }
	| { type: "failed"; session: string }
	| { type: "close" }
	| { type: "ask"; prompt: string; patterns: TContextPattern[]; session?: string; inReplyTo?: string; delegated: string[] }
	| { type: "started" }
	| { type: "text"; piece: string }
	| { type: "status"; line: string }
	| { type: "context"; lines: string[] }
	| { type: "called"; calls: TCalled[] }
	| { type: "recorded"; record: TRecord }
	| { type: "refused"; call: TRefusedCall }
	| { type: "stop"; reason: string }
	| { type: "ended" }
	| { type: "erred"; message: string };
export type TConversationEventType = TConversationEvent["type"];
/** The events a turn's request raises. They move the page's turn whatever conversation is open. */
export const REQUEST_EVENTS = [
	"started",
	"text",
	"status",
	"context",
	"called",
	"recorded",
	"refused",
	"stop",
	"ended",
	"erred",
] as const satisfies readonly TConversationEventType[];
export type TRequestEvent = Extract<TConversationEvent, { type: (typeof REQUEST_EVENTS)[number] }>;
/** Every event: the conversation's own events and its turn's request events. */
export const CONVERSATION_EVENTS = ["open", "read", "failed", "close", "ask", ...REQUEST_EVENTS] as const satisfies readonly TConversationEventType[];

/** The refusal of a question sent while a turn is in flight. */
export const TURN_IN_FLIGHT = "a turn is running; wait for its response or stop it";
/** The refusal of a question sent while the store reads the conversation back. */
export const CONVERSATION_OPENING = "the conversation is still opening; ask once its turns are shown";
/** The error of a turn whose stream ended before actuality started its step. */
export const NOT_STARTED = "the stream ended before actuality started the turn's step";
/** What a reply's spinner shows before the turn emits a status line. */
export const SENDING = "Sending...";
/** The key of a turn whose question actuality hasn't recorded. A new question replaces such a turn, so one key is enough. */
export const PENDING_TURN = "pending";

/** Whether a turn with the status was sent and hasn't ended. A turn without a status isn't in flight. */
export function inFlight(status: TChatStatus | undefined): boolean {
	return status === TURN_STATUS.asking || status === STATUS.running;
}

/** Whether a turn ended between two of its statuses. */
export function turnEnded(before: TChatStatus | undefined, after: TChatStatus | undefined): boolean {
	return inFlight(before) && !inFlight(after);
}

/** The stop reason of a turn the reader stopped. */
export const STOPPED_BY_THE_READER = "you stopped it";
