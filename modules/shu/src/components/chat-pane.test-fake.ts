/**
 * The page a pane test drives the Ask pane on.
 *
 * Several test files drive the pane and the conversation, and each needs the same run behind it: one that offers the
 * steps the pane calls, lists them when the page reads its steps, and takes the page's reports. Only the answers differ
 * between cases, so only the answers are written per case, and a change to what the pane calls is one edit rather than
 * one per file.
 */

import type { TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";
import { CLIENT_LOG_METHOD } from "../client-log.js";
import { ASK_STEP, KEEP_FILE_STEP } from "../conversation.js";
import type { TSessionTurn } from "../schemas.js";
import { stepsShown, type TDispatch } from "../test-setup.js";

/** The consumer's stepper that offers the steps the pane calls. */
export const CHAT_STEPPER = "AskingStepper";
/** The steps the pane and the conversation call, by name. */
export const CHAT_STEP = { ask: ASK_STEP, keepFile: KEEP_FILE_STEP, sessions: "listChatSessions", session: "loadChatSession", catalog: "showKihans" } as const;

/**
 * A dispatch answering the pane as a run that offers the steps named: the show steps step lists them with the types the
 * catalog declares, a call to one of them is answered by `respond` under the step's name, the page's reports to actuality are
 * taken as the monitor takes them, and any other call throws.
 */
export function chatDispatch(
	respond: (step: string, params: Record<string, unknown>) => unknown,
	{ steps = Object.values(CHAT_STEP), concerns }: { steps?: string[]; concerns?: TConcernCatalog } = {},
): TDispatch {
	const byMethod = new Map(steps.map((step) => [stepMethodName(CHAT_STEPPER, step), step]));
	const listed = stepsShown(
		[...byMethod].map(([method, stepName]) => ({ method, stepperName: CHAT_STEPPER, stepName, pattern: stepName })),
		{},
		concerns,
	);
	return (method, params) => {
		if (method === SHOW_STEPS_METHOD) return listed;
		if (method === CLIENT_LOG_METHOD) return {};
		const step = byMethod.get(method);
		if (!step) throw new Error(`unexpected ${method}`);
		return respond(step, params);
	};
}

/** The question record of the turn a case names, which names the turn, and the answer record of that turn. */
export const question = (turn: string): string => `cmt-ask-${turn}`;
export const answer = (turn: string): string => `cmt-say-${turn}`;

/** A turn of a session as the store reads it back, completed, its question and answer named by the turn a case names. */
export const readBack = (turn: string, inReplyTo?: string, bundle: TSessionTurn["bundle"] = []): TSessionTurn => ({
	prompt: `asked ${turn}`,
	response: `answered ${turn}`,
	askId: question(turn),
	sayId: answer(turn),
	...(inReplyTo ? { inReplyTo: question(inReplyTo) } : {}),
	bundle,
	generatedAtTime: `2026-01-01T00:00:${turn.replace(/\D/g, "").slice(-2).padStart(2, "0")}.000Z`,
	status: "completed",
});

/** The pane as a case drives it: the element, and what a case calls on it. */
export type TDriven = HTMLElement & {
	updateComplete: Promise<unknown>;
	submitChat(): Promise<void>;
	setState(s: Record<string, unknown>): void;
	fork(forking: { prompt: string; patterns: unknown[]; inReplyTo?: string; send: boolean }): Promise<void>;
};
