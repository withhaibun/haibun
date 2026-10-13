/**
 * The conversation as a machine: `transition` defines each move, and an event outside those moves leaves the state
 * unchanged. A turn's request raises the request events, and a reader's actions raise the others.
 */
import {
	NOTHING_STATED,
	NOT_STARTED,
	CONVERSATION_OPENING,
	TURN_IN_FLIGHT,
	inFlight,
	type TAskedTurn,
	type TConversationEvent,
	type TConversationState,
	type TRequestEvent,
	type TTurn,
} from "../domains/conversation.js";
import { STATUS } from "@haibun/core/schema/protocol.js";
import { TURN_STATUS } from "@haibun/core/lib/conversation/domains/conversation.js";

/** The conversation before a reader opens one, and after the reader closes it: the machine's initial state. */
export const CLOSED_CONVERSATION: TConversationState = { status: "closed", session: null, turns: [], asked: null };

/** The refusal of a question sent now, or null. A question is refused while a turn is in flight or the conversation is opening. */
export function askRefusal(conversation: TConversationState): string | null {
	if (inFlight(conversation.asked?.status)) return TURN_IN_FLIGHT;
	return conversation.status === "opening" ? CONVERSATION_OPENING : null;
}

/** Whether the open conversation contains the page's turn. It contains a turn sent in its session, and the first turn
 *  whose question opened it. */
export function asksIn(conversation: TConversationState): boolean {
	return conversation.status === "open" && conversation.asked !== null && conversation.asked.session === conversation.session;
}

/** The turn as the conversation holds it, without what only the page's request holds. */
export function turnOf({ session: _session, stoppedBy: _stoppedBy, delegated: _delegated, refused: _refused, ...turn }: TAskedTurn): TTurn {
	return turn;
}

/** Returns the conversation with the page's turn at its place in the turns, where the conversation contains the page's
 *  turn. Its place is the first turn with its question's id or with a null `askId`. Only the page's turn has a null
 *  `askId`, since a new question replaces such a turn. The page's turn is appended where the turns don't contain
 *  either. */
function withAsked(conversation: TConversationState): TConversationState {
	const { asked } = conversation;
	if (!asked || !asksIn(conversation)) return conversation;
	const at = conversation.turns.findIndex((turn) => turn.askId === asked.askId || turn.askId === null);
	const turns = at === -1 ? [...conversation.turns, turnOf(asked)] : conversation.turns.map((turn, index) => (index === at ? turnOf(asked) : turn));
	return { ...conversation, turns };
}

/** Returns the page's turn after a request event. Returns the turn unchanged where the event doesn't move it. */
function movedAsked(asked: TAskedTurn, event: TRequestEvent): TAskedTurn {
	if (!inFlight(asked.status)) return asked;
	const running = asked.status === STATUS.running;
	switch (event.type) {
		case "started":
			return running ? asked : { ...asked, status: STATUS.running };
		case "text":
			return running ? { ...asked, response: asked.response + event.piece } : asked;
		case "status":
			return running ? { ...asked, progress: event.line } : asked;
		case "context":
			return running ? { ...asked, context: [...asked.context, ...event.lines] } : asked;
		case "called":
			return running ? { ...asked, calls: [...asked.calls, ...event.calls] } : asked;
		case "recorded":
			// Actuality records the question first, then the response. The question's record names the turn.
			if (!running) return asked;
			return asked.askId === null ? { ...asked, askId: event.record.id, session: asked.session ?? event.record.id } : { ...asked, sayId: event.record.id };
		case "refused":
			// A person allows a refused action once for every call that needs it, so the turn lists each refused action once.
			return running && !asked.refused.some((refused) => refused.action === event.call.action) ? { ...asked, refused: [...asked.refused, event.call] } : asked;
		case "stop":
			return asked.stoppedBy ? asked : { ...asked, stoppedBy: event.reason };
		case "ended":
			return running ? { ...asked, status: STATUS.completed } : { ...asked, status: STATUS.failed, error: NOT_STARTED };
		case "erred":
			return asked.stoppedBy ? { ...asked, status: STATUS.stopped, error: `${asked.stoppedBy}: ${event.message}` } : { ...asked, status: STATUS.failed, error: event.message };
	}
}

/**
 * Returns the next state for any state and any event.
 *
 * `read` applies only to the session that is opening or open. A read that returns after the reader closed the
 * conversation or opened another session doesn't change the conversation. A turn the read returns keeps the context
 * lines and calls the page held for it, since the store doesn't hold them. `failed` applies only to the session that is
 * opening. `ask` is refused while a turn is in flight or the conversation is opening. It replaces a turn whose question
 * actuality didn't record. In a closed conversation it opens a conversation without a session. The page's turn moves on
 * its request's events whatever conversation is open. The first record of a first turn names the conversation that turn
 * opened.
 */
export function transition(conversation: TConversationState, event: TConversationEvent): TConversationState {
	const { asked } = conversation;
	switch (event.type) {
		case "open":
			return { ...conversation, status: "opening", session: event.session, turns: [] };
		case "read": {
			if (conversation.status === "closed" || conversation.session !== event.session) return conversation;
			const held = new Map(conversation.turns.map((turn) => [turn.askId, turn]));
			const turns = event.turns.map((turn) => {
				// A turn the page doesn't hold was sent from another page, so the page holds what it stated only for its own turns.
				const stated = held.get(turn.askId);
				const { context, calls } = stated === undefined ? NOTHING_STATED : stated;
				return { ...turn, progress: "", context, calls };
			});
			const read = { ...conversation, status: "open" as const, turns };
			// The store's copy of the page's turn is newer once the turn has ended. Until then the page's copy is newer.
			return !inFlight(asked?.status) && event.turns.some((turn) => turn.askId === asked?.askId) ? read : withAsked(read);
		}
		case "failed":
			return conversation.status === "opening" && conversation.session === event.session ? { ...CLOSED_CONVERSATION, asked } : conversation;
		case "close":
			return conversation.status === "closed" ? conversation : { ...CLOSED_CONVERSATION, asked };
		case "ask": {
			if (askRefusal(conversation)) return conversation;
			const { prompt, patterns, inReplyTo } = event;
			const next: TAskedTurn = {
				askId: null,
				prompt,
				response: "",
				bundle: patterns,
				// Actuality's record of the turn supplies its time.
				generatedAtTime: "",
				...(inReplyTo ? { inReplyTo } : {}),
				status: TURN_STATUS.asking,
				...NOTHING_STATED,
				session: event.session ?? null,
				stoppedBy: "",
				delegated: event.delegated,
				refused: [],
			};
			const opened = conversation.status === "closed" ? { status: "open" as const, session: null } : {};
			return withAsked({ ...conversation, ...opened, turns: conversation.turns.filter((turn) => turn.askId !== null), asked: next });
		}
		default: {
			if (!asked) return conversation;
			const moved = movedAsked(asked, event);
			if (moved === asked) return conversation;
			const named = asksIn(conversation) && conversation.session === null && moved.session !== null;
			return withAsked({ ...conversation, ...(named ? { session: moved.session } : {}), asked: moved });
		}
	}
}
