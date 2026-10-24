/**
 * The ask's composition root: the one conversation machine every bundle on the page shares, the question the reader is
 * writing, the turns the page read of each session, and what the page allows its turns and the store that keeps it.
 */
import type { TAction } from "@haibun/core/lib/domains/actions.js";
import { pagePinned } from "../adapters/page-held.js";
import { SharedCell } from "../adapters/shared-cell.js";
import { sharedMachine } from "../root.js";
import { pageKeyStore } from "../authority/root.js";
import type { TConversationEvent, TConversationState } from "./domains/conversation.js";
import { CLOSED_CONVERSATION, transition } from "./machines/conversation.js";
import type { TAllowanceScope, TKept } from "./ports.js";

const ALLOWANCE_KEY = "__SHU_TURN_ALLOWANCE__";

/** The conversation machine's one instance, which every view and bundle shares. */
export const conversationMachine = sharedMachine<TConversationState, TConversationEvent>("conversation", CLOSED_CONVERSATION, transition);

/** The question the reader is writing. The page holds it while the ask pane closes and opens again, and while the actions
 *  bar changes mode. */
export const askDraft = new SharedCell<string>("askDraft", "");

/**
 * The number of turns this page last read of each session, while the page is open. A session the reader opened counts as
 * read. The list shows the turns each session gained since this page last read it, and a session this page hasn't read
 * counts every turn as gained. A view reads the map as a signal, so opening a session updates the list.
 */
export const sessionsRead = new SharedCell<Readonly<Record<string, number>>>("sessionsRead", {});

/** The actions this page allows its turns, once read from its store. */
export const turnAllowance = new SharedCell<readonly TAction[]>("turnAllowance", []);

/** What the page keeps beside its key. */
const kept = (): TKept => {
	const store = pageKeyStore();
	return { read: (name) => store.read(name), keep: (name, value) => store.keep(name, value) };
};

/** What the page allows its turns, kept in its store and held in a cell, read once per page. */
export const allowanceScope = (): TAllowanceScope => ({ kept: kept(), allowed: turnAllowance, reading: pagePinned(ALLOWANCE_KEY, (): { read?: Promise<void> } => ({})) });
