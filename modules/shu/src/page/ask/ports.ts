/**
 * The ask's ports: what reading and following a conversation reads and writes, and what sending a turn reads and writes.
 */
import type { ICell } from "@haibun/core/lib/machines/cell.js";
import type { Machine } from "@haibun/core/lib/machines/machine.js";
import type { AccessQueryLevel } from "@haibun/core/lib/domains/resources.js";
import type { TClock, TConduit } from "../ports.js";
import type { TBatchedEvents } from "../pipelines/batched-events.js";
import type { TSubjectEvent } from "../../current-subject.js";
import type { TConversationEvent, TConversationState } from "./domains/conversation.js";
import type { TAskSteps } from "./derivations/ask-steps.js";
import type { TDelegationTo } from "../authority/delegation/pipelines/delegate.js";

/** What reading and following a conversation reads and writes: the conversation, the turns the page read of each session,
 *  actuality's steps as read and as held, the conduit, actuality's stream where the page has one, the active record's
 *  scopes, the page's read level, the view hash's session, and the report of a failure. */
export type TConversationScope = {
	conversation: Machine<TConversationState, TConversationEvent>;
	sessionsRead: ICell<Readonly<Record<string, number>>>;
	readSteps: () => Promise<unknown>;
	steps: () => TAskSteps | undefined;
	conduit: () => TConduit;
	streams: () => boolean;
	batched: (events: TBatchedEvents) => () => void;
	subject: (event: TSubjectEvent) => void;
	readLevel: () => AccessQueryLevel;
	address: (session: string | null) => void;
	report: (message: string) => void;
};

/** What a page keeps beside its key, which outlives a reload. */
export type TKept = { read(name: string): Promise<unknown>; keep(name: string, value: unknown): Promise<void> };

/** What the page allows its turns: the store it is kept in, and the actions as the page holds them. */
export type TAllowanceScope = { kept: TKept; allowed: ICell<readonly string[]>; reading: { read?: Promise<void> } };

/** What sending a turn reads and writes, beside a conversation's scope: whether the deployment verifies delegations, the
 *  delegation the page signs, the actions the page holds and may grant, what the reader allowed its turns, the page's
 *  origin, and the clock that paces a turn's text to the page's frames. */
export type TTurnScope = TConversationScope & {
	verifiesDelegations: () => boolean;
	delegate: (to: TDelegationTo) => Promise<Record<string, unknown>>;
	holds: () => readonly string[];
	may: (action: string) => boolean;
	allowance: () => Promise<readonly string[]>;
	origin: () => string;
	clock: TClock;
};
