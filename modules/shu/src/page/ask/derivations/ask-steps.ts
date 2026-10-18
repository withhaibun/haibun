/**
 * The steps a conversation calls and the type of the models it lists, found through core's conversation contract rather
 * than by the names a stepper gives its methods: the step that takes a question and returns a response sends a turn, and
 * each other step is the one that returns its domain. The models are the records of the type that states itself a
 * conversation model.
 */
import { CONVERSATION_DOMAIN, CONVERSATION_MODEL_CLASS } from "@haibun/core/lib/conversation/domains/conversation.js";
import type { TConcernCatalog } from "@haibun/core/lib/domains/hypermedia.js";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import type { TStepList } from "../../machines/registry.js";
import { stepsJoining } from "../../derivations/steps.js";

/** The steps of a conversation: the one that sends a turn, and those that read a session, list the sessions, open a turn's
 *  key and keep a question's file, where a stepper declares them. */
export type TAskSteps = { ask: TStepDefinition; session?: TStepDefinition; sessions?: TStepDefinition; turnKey?: TStepDefinition; file?: TStepDefinition };

/** Returns the one step of `steps`, or undefined where `steps` is empty. Throws where more than one is declared, since a
 *  deployment loads one conversation stepper. */
function oneOf(steps: TStepDefinition[], what: string): TStepDefinition | undefined {
	const [first, ...others] = steps;
	if (others.length > 0) throw new Error(`${steps.map((step) => step.method).join(", ")} each ${what}; a deployment loads one conversation stepper`);
	return first;
}

/** Returns the step that returns `domain`. */
const returning = (list: TStepList, domain: string): TStepDefinition | undefined => oneOf(stepsJoining(list, domain).returning, `return ${domain}`);

/** Returns the steps of a conversation, or undefined where actuality doesn't declare a step that sends a turn. */
export function askSteps(list: TStepList): TAskSteps | undefined {
	const answers = new Set(stepsJoining(list, CONVERSATION_DOMAIN.RESPONSE).returning);
	const ask = oneOf(
		stepsJoining(list, CONVERSATION_DOMAIN.QUESTION).taking.filter((step) => answers.has(step)),
		`take ${CONVERSATION_DOMAIN.QUESTION} and return ${CONVERSATION_DOMAIN.RESPONSE}`,
	);
	if (ask === undefined) return undefined;
	const steps: TAskSteps = { ask };
	const session = returning(list, CONVERSATION_DOMAIN.SESSION);
	const sessions = returning(list, CONVERSATION_DOMAIN.SESSIONS);
	const turnKey = returning(list, CONVERSATION_DOMAIN.TURN_KEY);
	const file = returning(list, CONVERSATION_DOMAIN.FILE);
	return { ...steps, ...(session ? { session } : {}), ...(sessions ? { sessions } : {}), ...(turnKey ? { turnKey } : {}), ...(file ? { file } : {}) };
}

/** Returns the type of the models an ask lists: the type that states itself a conversation model, or undefined where the
 *  catalog doesn't declare one. Throws where more than one does. */
export function modelType(catalog: TConcernCatalog): string | undefined {
	const types = Object.values(catalog.persisted).filter((concern) => concern.subClassOf.includes(CONVERSATION_MODEL_CLASS));
	const [first, ...others] = types;
	if (others.length > 0)
		throw new Error(`${types.map((concern) => concern.label).join(", ")} each state themselves ${CONVERSATION_MODEL_CLASS}; a deployment declares one model type`);
	return first?.label;
}
