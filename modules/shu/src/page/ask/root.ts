/**
 * The ask's composition root: the one conversation machine every bundle on the page shares, the question the reader is
 * writing, the turns the page read of each session, and what the page allows its turns and the store that keeps it.
 */
import type { TAction } from "@haibun/core/lib/domains/actions.js";
import { pagePinned } from "../adapters/page-held.js";
import { SharedCell } from "../adapters/shared-cell.js";
import { Machine, type TMove } from "@haibun/core/lib/machines/machine.js";
import { pageKeyStore } from "../authority/root.js";
import type { TConversationEvent, TConversationState } from "./domains/conversation.js";
import { CLOSED_CONVERSATION, transition } from "./machines/conversation.js";
import type { TAllowanceScope, TKept } from "./ports.js";

const ALLOWANCE_KEY = "__SHU_TURN_ALLOWANCE__";

declare global {
	interface TShuPageValues {
		[ALLOWANCE_KEY]: { read?: Promise<void> };
	}
	interface TShuPageCells {
		conversation: TConversationState;
		"conversation:moves": TMove<TConversationState, TConversationEvent> | null;
		askDraft: string;
		sessionsRead: Readonly<Record<string, number>>;
		turnAllowance: readonly TAction[];
	}
}

/** The conversation machine's one instance, whose state and moves are cells every view in every bundle reads and follows. */
export const conversationMachine = new Machine(new SharedCell("conversation", CLOSED_CONVERSATION), new SharedCell("conversation:moves", null), transition);

/** The question the reader is writing. The page holds it while the ask pane closes and opens again, and while the actions
 *  bar changes mode. */
export const askDraft = new SharedCell("askDraft", "");

/**
 * The number of turns this page last read of each session, while the page is open. A session the reader opened counts as
 * read. The list shows the turns each session gained since this page last read it, and a session this page hasn't read
 * counts every turn as gained. A view reads the map as a signal, so opening a session updates the list.
 */
export const sessionsRead = new SharedCell("sessionsRead", {});

/** The actions this page allows its turns, once read from its store. */
export const turnAllowance = new SharedCell("turnAllowance", []);

/** What the page keeps beside its key. */
const kept = (): TKept => {
	const store = pageKeyStore();
	return { read: (name) => store.read(name), keep: (name, value) => store.keep(name, value) };
};

/** What the page allows its turns, kept in its store and held in a cell, read once per page. */
export const allowanceScope = (): TAllowanceScope => ({ kept: kept(), allowed: turnAllowance, reading: pagePinned(ALLOWANCE_KEY, () => ({})) });
