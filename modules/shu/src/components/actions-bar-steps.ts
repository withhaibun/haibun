/**
 * The actions bar's step mode: the steps the run offers, the step input line, and a caller for the step a reader picks,
 * opened in the bar's history. The steps for the selected type come first, marked. A reader who picks another step
 * before running the last caller retargets that caller rather than adding a second, and each caller is numbered among
 * the callers of its method, so its test ids stay unique across repeated calls.
 */
import { html, nothing, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from "lit";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
import { getAvailableSteps, stepsForContext, type StepDescriptor } from "../rpc-registry.js";
import type { TComboboxOption } from "../schemas.js";
import { prettifyGwta } from "../util.js";
import type { ShuActivityHistory } from "./shu-activity-history.js";
import type { ShuCombobox } from "./shu-combobox.js";

/** The step a turn of the ask runs, whose presence offers the Ask mode. */
const ASK_STEP = "chatWithContext";
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

/** What the steps read from the bar: its test-id prefix, the selected type, the history callers open in, and the step
 *  selector once rendered. */
export type TActionsBarStepsDeps = {
	testIdPrefix: () => string;
	selectedLabel: () => string;
	history: () => ShuActivityHistory;
	combo: () => ShuCombobox | null;
};

/** A step caller as the steps address it: whether it has run its step, and how it is pointed at another. */
type TStepCaller = HTMLElement & { executed?: boolean; reset?: (method: string) => void };

export class ActionsBarSteps implements ReactiveController {
	readonly #host: ReactiveControllerHost & HTMLElement;
	readonly #deps: TActionsBarStepsDeps;
	#steps: StepDescriptor[] = [];

	constructor(host: ReactiveControllerHost & HTMLElement, deps: TActionsBarStepsDeps) {
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

	/** After each render, the step selector offers the steps, those for the selected type first. */
	hostUpdated(): void {
		const combo = this.#deps.combo();
		if (!combo) return;
		const label = this.#deps.selectedLabel();
		combo.setOptions(stepOptions(this.#steps, label ? stepsForContext(label) : []));
	}

	/** Whether the run offers the step an ask runs, which decides whether a chosen Ask mode renders. */
	get offersAsk(): boolean {
		return this.#steps.some((step) => step.method.endsWith(ASK_STEP));
	}

	/** Read the steps the run offers, and render with them. */
	async load(): Promise<void> {
		this.#steps = await getAvailableSteps();
		this.#host.requestUpdate();
	}

	/** Select the step in the selector and open its caller, with fixed arguments and run at once where given. */
	pick(method: string, args?: Record<string, unknown>, auto?: boolean): void {
		this.#deps.combo()?.setValue(method);
		this.open(method, args, auto);
	}

	/**
	 * Open a caller for the step in the history, or retarget the last caller where it has not run and nothing is fixed
	 * for it. A caller carries the method it dispatches, the step's pattern as its test-id prefix, and its number among
	 * the callers of that method. The newest caller is kept in view.
	 */
	open(method: string, args?: Record<string, unknown>, auto?: boolean): void {
		const history = this.#deps.history();
		const callersOf = () => history.querySelectorAll(`${SHU_TAG.STEP_CALLER}[method="${method}"]`).length;
		const step = this.#steps.find((offered) => offered.method === method);
		const gwta = step ? prettifyGwta(step.pattern) : method;
		const last = history.querySelector<TStepCaller>(`${SHU_TAG.STEP_CALLER}:last-of-type`);
		if (last && !last.executed && last.reset && !args && !auto) {
			// Counted before the caller takes the method, so it counts the other callers of it and never itself.
			const index = callersOf() - (last.getAttribute("method") === method ? 1 : 0);
			last.setAttribute("method", method);
			last.setAttribute("gwta", gwta);
			last.setAttribute("call-index", String(index));
			last.reset(method);
			history.scrollToBottom();
			return;
		}
		const caller = document.createElement(SHU_TAG.STEP_CALLER);
		caller.setAttribute("step", method);
		caller.setAttribute("method", method);
		caller.setAttribute("gwta", gwta);
		caller.setAttribute("call-index", String(callersOf()));
		if (args) caller.setAttribute("params", JSON.stringify(args));
		if (auto) caller.setAttribute("auto", "");
		history.appendChild(caller);
		history.scrollToBottom();
	}

	/** The step mode's input line: the mode toggle, and the step selector once the run offers steps. */
	template(modeToggle: TemplateResult): TemplateResult {
		const selector =
			this.#steps.length > 0
				? html`<shu-combobox class="step-combo"
					testid=${`${this.#deps.testIdPrefix()}step-select`}
					placeholder="type to filter steps..."
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
		if (method) this.open(method);
	};

	/** A caller's result lands after it was opened and grows it in place, so the newest output is kept in view. */
	#onSettled = (): void => {
		this.#deps.history().scrollToBottom();
	};
}
