/**
 * The page on which a pane test drives the Ask pane.
 *
 * Several test files drive the pane and the conversation, and each needs the same actuality behind it: one that offers the
 * steps the pane calls, lists them when the page reads its steps, and takes the page's reports. Only the responses differ
 * between cases, so only the responses are written per case, and a change to what the pane calls is one edit rather than
 * one per file.
 */

import { buildConcernCatalog, counted, type TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { CLIENT_LOG_METHOD } from "../../../client-log.js";
import { ASK_PARAM, CONVERSATION_DOMAIN, CONVERSATION_MODEL_CLASS, FILE_PARAM, SESSION_PARAM, type TSessionTurn } from "@haibun/core/lib/conversation/domains/conversation.js";
import { persistedTypeDefinition, stepsShown, type TDispatch } from "../../../test/setup.js";

/** The consumer's stepper that offers the steps the pane calls. */
export const CHAT_STEPPER = "AskingStepper";
/** The steps the pane and the conversation call, by name. The names are the fixture's own: the pane finds each step by the
 *  domains core's conversation contract declares, so a stepper names its methods as it chooses. */
export const CHAT_STEP = { ask: "putQuestion", keepFile: "holdQuestionFile", sessions: "listConversations", session: "readConversation", catalog: "graphQuery" } as const;

/** The domain of the model an ask names, as the consumer declares it. */
const MODEL_DOMAIN = "asking-model";
/** What each step takes and returns, by name. */
export const CHAT_DECLARED: Record<string, { paramDomains: Record<string, string>; productsDomain?: string }> = {
	[CHAT_STEP.ask]: {
		paramDomains: { [ASK_PARAM.model]: MODEL_DOMAIN, [ASK_PARAM.readLevel]: "text", [ASK_PARAM.prompt]: "text", [ASK_PARAM.question]: CONVERSATION_DOMAIN.QUESTION },
		productsDomain: CONVERSATION_DOMAIN.RESPONSE,
	},
	[CHAT_STEP.keepFile]: { paramDomains: { [FILE_PARAM.file]: "text", [FILE_PARAM.name]: "text" }, productsDomain: CONVERSATION_DOMAIN.FILE },
	[CHAT_STEP.sessions]: { paramDomains: {}, productsDomain: CONVERSATION_DOMAIN.SESSIONS },
	[CHAT_STEP.session]: { paramDomains: { [SESSION_PARAM]: "text" }, productsDomain: CONVERSATION_DOMAIN.SESSION },
	[CHAT_STEP.catalog]: { paramDomains: {} },
};
/** The type the consumer's models are records of, which states itself a conversation model. */
export const MODEL_TYPE = "AskingModel";
/** The catalog of a run that declares only its model type. */
const MODELS_ONLY = buildConcernCatalog(mapDefinitionsToDomains([persistedTypeDefinition(MODEL_TYPE, { subClassOf: CONVERSATION_MODEL_CLASS })]));
/** The domains the steps name, as a read of the steps lists them. */
export const CHAT_DOMAINS = Object.fromEntries([...Object.values(CONVERSATION_DOMAIN), MODEL_DOMAIN, "text"].map((key) => [key, { description: key }]));

/**
 * A dispatch that responds to the pane as an actuality that offers the steps named: the show steps step lists them with the types the
 * catalog declares, a call to one of them returns what `respond` gives under the step's name, the page's reports to actuality are
 * taken as the monitor takes them, and any other call throws.
 */
export function chatDispatch(
	respond: (step: string, params: Record<string, unknown>) => unknown,
	{ steps = Object.values(CHAT_STEP), concerns = MODELS_ONLY }: { steps?: string[]; concerns?: TConcernCatalog } = {},
): TDispatch {
	const byMethod = new Map(steps.map((step) => [stepMethodName(CHAT_STEPPER, step), step]));
	const listed = stepsShown(
		[...byMethod].map(([method, stepName]) => ({ method, stepperName: CHAT_STEPPER, stepName, pattern: stepName, ...CHAT_DECLARED[stepName] })),
		CHAT_DOMAINS,
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

/** The question record of the turn a case names, which names the turn, and the response record of that turn. */
/** A catalog read that returns one model, which takes tool calls. */
export const A_CATALOG = { vertices: [{ id: "openai:a-model", displayName: "a model", capabilities: { tools: true } }], ...counted(1) };

export const question = (turn: string): string => `cmt-ask-${turn}`;
export const answer = (turn: string): string => `cmt-say-${turn}`;

/** A turn of a session as the store reads it back, completed, its question and response named by the turn a case names. */
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
