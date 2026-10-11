/**
 * The conversation as the views and a deployment's views read it: the conversation's state and its events, the sessions,
 * a turn, the transcript, and what the page allows its turns. Each call reads the page through the scopes this controller
 * builds, and the page follows its conversation from the moment a bundle loads this module.
 */
import { CONVERSATION_PARAM } from "../../../domains/elements.js";
import { appAccessLevel } from "../../../view-query.js";
import { reportToRun } from "../../../client-log.js";
import { dispatchSubjectEvent } from "../../../current-subject.js";
import { pageClock } from "../../root.js";
import { conduit } from "../../controllers/conduit-controller.js";
import { conversationSteps, getAvailableSteps } from "../../controllers/registry-controller.js";
import { hasEventStream, subscribeBatchedEvents } from "../../controllers/event-stream-controller.js";
import { mergeHashParams } from "../../controllers/hash-controller.js";
import { deploymentVerifiesDelegations } from "../../controllers/hydration-controller.js";
import { pageHolds, pageMay } from "../../authority/controllers/page-authority-controller.js";
import { delegateFromPage } from "../../authority/delegation/controllers/delegation-controller.js";
import { allowanceScope, conversationMachine, sessionsRead } from "../root.js";
import type { TConversationScope, TTurnScope } from "../ports.js";
import type { TAskedTurn, TConversationEvent, TConversationState } from "../domains/conversation.js";
import * as Sessions from "../pipelines/sessions.js";
import * as Turn from "../pipelines/start-turn.js";
import * as Allowance from "../pipelines/turn-allowance.js";

export { askDraft, sessionsRead, turnAllowance } from "../root.js";
export { STOPPED_BY_THE_READER, inFlight, turnEnded, type TAskedTurn, type TConversationState } from "../domains/conversation.js";
export { CLOSED_CONVERSATION, askRefusal } from "../machines/conversation.js";
export { transcript } from "../derivations/transcript.js";
export { nextQuestion } from "../derivations/next-question.js";
export { TURN_ALLOWANCE_KEPT_AS } from "../pipelines/turn-allowance.js";
export type { TTurnRequest } from "../pipelines/start-turn.js";

/** The source the conversation reports under. */
const CONVERSATION_SOURCE = "conversation";

/** What reading and following the conversation reads and writes on this page. */
const conversationScope = (): TConversationScope => ({
	conversation: conversationMachine,
	sessionsRead,
	readSteps: getAvailableSteps,
	steps: conversationSteps,
	conduit,
	streams: hasEventStream,
	batched: subscribeBatchedEvents,
	subject: dispatchSubjectEvent,
	readLevel: appAccessLevel,
	address: (session) => mergeHashParams({ [CONVERSATION_PARAM]: session === null ? undefined : session }),
	report: (message) => reportToRun("error", CONVERSATION_SOURCE, message),
});

/** What sending a turn reads and writes on this page. */
const turnScope = (): TTurnScope => ({
	...conversationScope(),
	verifiesDelegations: deploymentVerifiesDelegations,
	delegate: delegateFromPage,
	holds: pageHolds,
	may: pageMay,
	allowance: () => Allowance.readTurnAllowance(allowanceScope()),
	origin: () => location.origin,
	clock: pageClock(),
});

/** The conversation's state, which a view reads as a signal. */
export const conversationState = conversationMachine.state;

/** Moves the conversation, and returns its state after the move. */
export const dispatchConversationEvent = (event: TConversationEvent): TConversationState => conversationMachine.dispatch(event);

/** Opens the conversation on a session and reads its turns back. */
export const openConversation = (session: string, answer: "activate" | "update"): Promise<void> => Sessions.openConversation(conversationScope(), session, answer);

/** Closes the conversation, so the next question starts a session. */
export const closeConversation = (): void => Sessions.closeConversation(conversationScope());

/** Calls `onReport` when actuality reports a turn's step starting or ending. Returns the call that stops following. */
export const followReportedTurns = (onReport: () => void): (() => void) => Sessions.followReportedTurns(conversationScope(), onReport);

/** Reads the open conversation's session again on each report of a turn. Returns the call that stops following. */
export const followRunningTurns = (): (() => void) => Sessions.followRunningTurns(conversationScope());

/** How many turns a session gained since this page last read it. */
export const gainedSince = (session: string, turns: number): number => Sessions.gainedSince(sessionsRead.get(), session, turns);

/** Sends a turn's question, and returns the turn's final state. */
export const startTurn = (request: Turn.TTurnRequest): Promise<TAskedTurn> => Turn.startTurn(turnScope(), request);

/** What this page allows its turns, read from its store once per page. */
export const readTurnAllowance = (): Promise<readonly string[]> => Allowance.readTurnAllowance(allowanceScope());

/** Allows `action` for the turns this page sends. */
export const allowForTurns = (action: string): Promise<void> => Allowance.allowForTurns(allowanceScope(), action);

/** Withdraws `action` from what the turns this page sends are given. */
export const withdrawFromTurns = (action: string): Promise<void> => Allowance.withdrawFromTurns(allowanceScope(), action);

// The page follows its conversation as soon as a bundle loads the ask: the actions bar's scope holds the conversation's
// newest record, and the view hash names its session.
Sessions.followConversation(conversationScope());
