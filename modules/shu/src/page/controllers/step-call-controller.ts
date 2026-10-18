/**
 * A call of a step from its form, held in the step call machine (`page/machines/step-call.ts`): the step the form calls,
 * the values the form refused, and what the call returned or its refusal. The view draws again at each move.
 */
import type { ReactiveControllerHost } from "lit";
import { machine, type Machine } from "@haibun/core/lib/machines/machine.js";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import { INITIAL_STEP_CALL, STEP_CALL_EVENT, STEP_CALL_STATUS, stepCallTransition, type TStepCallEvent, type TStepCallState } from "../machines/step-call.js";
import type { TPageRefusal } from "../domains/refusal.js";
import { outcomeOf } from "../pipelines/call-step.js";
import { findStep, getAvailableSteps } from "./registry-controller.js";
import { followCall } from "./read-controller.js";

export class StepCallController {
	readonly #machine: Machine<TStepCallState, TStepCallEvent> = machine<TStepCallState, TStepCallEvent>(INITIAL_STEP_CALL, stepCallTransition);

	constructor(host: ReactiveControllerHost) {
		this.#machine.follow(() => host.requestUpdate());
	}

	get #state(): TStepCallState {
		return this.#machine.state.get();
	}

	/** Returns the definition of the step `method` names, once the page has read actuality's steps. Throws for a step that
	 *  actuality doesn't declare. */
	async definitionOf(method: string): Promise<TStepDefinition> {
		await getAvailableSteps();
		const definition = findStep(method);
		if (definition === undefined) throw new Error(`<shu-step-caller> calls ${method}, which actuality doesn't declare`);
		return definition;
	}

	/** Whether a call is under way. */
	get calling(): boolean {
		return this.#state.status === STEP_CALL_STATUS.CALLING;
	}

	/** Whether the form has called the step, or refused its values. */
	get executed(): boolean {
		const { status } = this.#state;
		return status !== STEP_CALL_STATUS.READY && status !== STEP_CALL_STATUS.CALLING;
	}

	/** The refusal of the form's values or of the call, where one holds. */
	get refusal(): TPageRefusal | undefined {
		const state = this.#state;
		return state.status === STEP_CALL_STATUS.INVALID || state.status === STEP_CALL_STATUS.FAILED ? state.refusal : undefined;
	}

	/** Each refused field's cause, by its name. */
	get fieldErrors(): Record<string, string> {
		const state = this.#state;
		return state.status === STEP_CALL_STATUS.INVALID ? state.fieldErrors : {};
	}

	/** Whether the call returned, and what it returned. */
	get returned(): { result: unknown } | undefined {
		const state = this.#state;
		return state.status === STEP_CALL_STATUS.RETURNED ? { result: state.result } : undefined;
	}

	/** Refuses the form's values. */
	refuseInput(error: string, fieldErrors: Record<string, string>): void {
		this.#machine.dispatch({ type: STEP_CALL_EVENT.REFUSE_INPUT, refusal: { error }, fieldErrors });
	}

	/** Calls the step `method` names with `params`, and resolves once the call ends. */
	async call(method: string, params: Record<string, unknown>): Promise<void> {
		this.#machine.dispatch({ type: STEP_CALL_EVENT.CALL });
		const outcome = await outcomeOf(() => followCall({ method, params }, `a call of ${method} from its form`));
		this.#machine.dispatch(outcome.ok ? { type: STEP_CALL_EVENT.RETURN, result: outcome.value } : { type: STEP_CALL_EVENT.FAIL, refusal: outcome.refusal });
	}
}
