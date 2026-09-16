/**
 * The actions bar's step mode: the steps the run offers, the step input line, and a caller for the step a reader picks,
 * opened in the bar's history. The steps for the selected type come first, marked. A reader who picks another step
 * before running the last caller replaces that caller rather than adding a second, and each caller is numbered among
 * the callers of its method, so its test ids stay unique across repeated calls.
 */
import { html, nothing, type ReactiveController, type TemplateResult } from "lit";
import { ASK_STEP } from "../conversation.js";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
import { getAvailableSteps, stepsForContext, type StepDescriptor } from "../rpc-registry.js";
import type { TComboboxOption } from "../schemas.js";
import { prettifyGwta } from "../util.js";
import type { TActionsBarHost } from "./actions-bar-model.js";
import type { ShuActivityHistory } from "./shu-activity-history.js";

/** What marks a step offered for the selected type. */
const FOR_THE_TYPE = "● ";

/** The line under a step option: the domains of its inputs and of its output, `A, B → C`, or fewer parts where it
 *  declares fewer. */
export function stepSecondary(step: StepDescriptor): string {
	const inputs = step.paramDomains ? Object.values(step.paramDomains).join(", ") : "";
	const output = step.productsDomain ?? "";
	if (inputs && output) return `${inputs} → ${output}`;
	if (inputs) return inputs;
	if (output) return `→ ${output}`;
	return "";
}

/** What an option reveals when focused: each input's domain, the output's, and the capability it requires. The label
 *  already shows the pattern, so this does not repeat it. */
export function stepDetails(step: StepDescriptor): string {
	const lines: string[] = [];
	if (step.paramDomains && Object.keys(step.paramDomains).length > 0) {
		lines.push("inputs:");
		for (const [name, domain] of Object.entries(step.paramDomains)) lines.push(`  ${name}: ${domain}`);
	}
	if (step.productsDomain) lines.push(`outputs: ${step.productsDomain}`);
	if (step.capability) lines.push(`capability: ${step.capability}`);
	return lines.join("\n");
}

/** The step options: the steps offered for the selected type first, marked, then every other step. Each option's value
 *  is the step's full method, since a step's own name can repeat across steppers. */
export function stepOptions(steps: readonly StepDescriptor[], forTheType: readonly StepDescriptor[]): TComboboxOption[] {
	const typeMethods = new Set(forTheType.map((step) => step.method));
	const option = (step: StepDescriptor, marked: boolean): TComboboxOption => ({
		value: step.method,
		label: `${marked ? FOR_THE_TYPE : ""}${prettifyGwta(step.pattern)}`,
		secondary: stepSecondary(step),
		details: stepDetails(step),
	});
	return [...forTheType.map((step) => option(step, true)), ...steps.filter((step) => !typeMethods.has(step.method)).map((step) => option(step, false))];
}

/** What the steps read from the bar: its test-id prefix, the selected type, and the history callers open in. */
export type TActionsBarStepsDeps = {
	testIdPrefix: () => string;
	selectedLabel: () => string;
	history: ShuActivityHistory;
};

/** A step caller as the steps address it: whether it has run its step. */
type TStepCaller = HTMLElement & { executed?: boolean };

export class ActionsBarSteps implements ReactiveController {
	readonly #host: TActionsBarHost;
	readonly #deps: TActionsBarStepsDeps;
	#steps: StepDescriptor[] = [];
	/** The step the selector shows as chosen. */
	#chosen = "";

	constructor(host: TActionsBarHost, deps: TActionsBarStepsDeps) {
		this.#host = host;
		this.#deps = deps;
		host.addController(this);
	}

	hostConnected(): void {
		this.#host.addEventListener(SHU_EVENT.STEP_SUCCESS, this.#onSettled);
		this.#host.addEventListener(SHU_EVENT.STEP_ERROR, this.#onSettled);
	}

	hostDisconnected(): void {
		this.#host.removeEventListener(SHU_EVENT.STEP_SUCCESS, this.#onSettled);
		this.#host.removeEventListener(SHU_EVENT.STEP_ERROR, this.#onSettled);
	}

	/** Whether the run offers the step an ask runs, which decides whether a chosen Ask mode renders. */
	get offersAsk(): boolean {
		return this.#steps.some((step) => step.stepName === ASK_STEP);
	}

	/** Read the steps the run offers, and render with them. */
	async load(): Promise<void> {
		this.#steps = await getAvailableSteps();
		this.#host.requestUpdate();
	}

	/** Select the step in the selector and open its caller, with fixed arguments and run at once where given. */
	pick(method: string, args?: Record<string, unknown>, auto?: boolean): void {
		this.#chosen = method;
		this.#host.requestUpdate();
		this.open(method, args, auto);
	}

	/**
	 * Open a caller for the step at the end of the history. The last caller is removed first where it has not run and
	 * nothing is fixed for the new one, so a reader trying steps keeps one caller. A caller carries the method it
	 * dispatches, the step's pattern as its test-id prefix, and its number among the callers of that method. The newest
	 * caller is kept in view.
	 */
	open(method: string, args?: Record<string, unknown>, auto?: boolean): void {
		const history = this.#deps.history;
		const last = history.querySelector<TStepCaller>(`${SHU_TAG.STEP_CALLER}:last-of-type`);
		if (last && !last.executed && !args && !auto) last.remove();
		const step = this.#steps.find((offered) => offered.method === method);
		const caller = document.createElement(SHU_TAG.STEP_CALLER);
		caller.setAttribute("step", method);
		caller.setAttribute("method", method);
		caller.setAttribute("gwta", step ? prettifyGwta(step.pattern) : method);
		caller.setAttribute("call-index", String(history.querySelectorAll(`${SHU_TAG.STEP_CALLER}[method="${method}"]`).length));
		if (args) caller.setAttribute("params", JSON.stringify(args));
		if (auto) caller.setAttribute("auto", "");
		history.appendChild(caller);
		history.scrollToBottom();
	}

	/** The step mode's input line: the mode toggle, and the step selector once the run offers steps, those for the selected
	 *  type first. */
	template(modeToggle: TemplateResult): TemplateResult {
		const label = this.#deps.selectedLabel();
		const selector =
			this.#steps.length > 0
				? html`<shu-combobox class="step-combo"
					testid=${`${this.#deps.testIdPrefix()}step-select`}
					placeholder="type to filter steps..."
					.options=${stepOptions(this.#steps, label ? stepsForContext(label) : [])}
					.value=${this.#chosen}
					@combo-change=${this.#onComboChange}></shu-combobox>`
				: nothing;
		return html`
			<div class="input-line">
				${modeToggle}
				${selector}
			</div>`;
	}

	#onComboChange = (e: CustomEvent): void => {
		const method = e.detail?.value;
		if (!method) return;
		this.#chosen = method;
		this.open(method);
	};

	/** A caller's result lands after it was opened and grows it in place, so the newest output is kept in view. */
	#onSettled = (): void => {
		this.#deps.history.scrollToBottom();
	};
}
