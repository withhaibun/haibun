/**
 * The actions bar's step mode: the steps actuality offers, the step input line, and a caller for the step a reader picks,
 * opened in the bar's history. The steps for the selected type come first, marked. A reader who picks another step
 * before running the last caller replaces that caller rather than adding a second, and each caller is numbered among
 * the callers of its method, so its test ids stay unique across repeated calls.
 */
import { html, nothing, type ReactiveController, type TemplateResult } from "lit";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { VALIDATE_STEP_METHOD, waypointMark, type TPredicate, type TStepDefinition, type TStepValidation } from "@haibun/core/lib/step-discovery.js";
import { callStep } from "../controllers/read-controller.js";
import type { TPageRefusal } from "../domains/refusal.js";
import type { ShuRefusal } from "./shu-refusal.js";
import { conversationSteps, getAvailablePredicates, getAvailableSteps, requireStep, stepsForContext, StepsChangedController } from "../controllers/registry-controller.js";
import type { TComboboxOption } from "../../domains/schemas.js";
import type { TControllerHost } from "./controller-host.js";
import type { ShuActivityHistory } from "./shu-activity-history.js";
import type { ShuCombobox } from "./shu-combobox.js";
import type { ShuStepCaller } from "./shu-step-caller.js";
import "./shu-step-caller.js";
import { prettifyGwta } from "../derivations/steps.js";
import "./shu-combobox.js";

/** What opens a step's caller: fixed arguments, whether it runs at once, and the starting values its inputs show. */
type TStepOpening = { args?: Record<string, unknown>; auto?: boolean; values?: Record<string, string> };

/** What marks a step offered for the selected type. */
const FOR_THE_TYPE = "● ";

/** The line under a step option: the domains of its inputs and of its output, `A, B → C`, or fewer parts where it
 *  declares fewer. */
export function stepSecondary(step: TStepDefinition): string {
	const inputs = Object.values(step.paramDomains).join(", ");
	const output = step.productsDomain ?? "";
	if (inputs && output) return `${inputs} → ${output}`;
	if (inputs) return inputs;
	if (output) return `→ ${output}`;
	return "";
}

/** What an option reveals when focused: each input's domain, the output's, and the capability it requires. The label
 *  already shows the pattern, so this does not repeat it. */
export function stepDetails(step: TStepDefinition): string {
	const lines: string[] = [];
	if (Object.keys(step.paramDomains).length > 0) {
		lines.push("inputs:");
		for (const [name, domain] of Object.entries(step.paramDomains)) lines.push(`  ${name}: ${domain}`);
	}
	if (step.productsDomain) lines.push(`outputs: ${step.productsDomain}`);
	if (step.capability) lines.push(`capability: ${step.capability}`);
	return lines.join("\n");
}

/** The step options: the steps offered for the selected type first, marked, then every other step. Each option's value
 *  is the step's full method, since a step's own name can repeat across steppers. */
export function stepOptions(steps: readonly TStepDefinition[], forTheType: readonly TStepDefinition[]): TComboboxOption[] {
	const typeMethods = new Set(forTheType.map((step) => step.method));
	const option = (step: TStepDefinition, marked: boolean): TComboboxOption => ({
		value: step.method,
		label: `${marked ? FOR_THE_TYPE : ""}${prettifyGwta(step.pattern)}`,
		secondary: stepSecondary(step),
		details: stepDetails(step),
	});
	return [...forTheType.map((step) => option(step, true)), ...steps.filter((step) => !typeMethods.has(step.method)).map((step) => option(step, false))];
}

/** The step that ensures a waypoint, which a pick of a waypoint's head opens with the head as its statement. */
const ENSURE = "ensure";

/** The options of the waypoints actuality holds: each head as a sentence, marked as a waypoint with the library that states
 *  its rule. Each option's value is the head, which a pick opens as the statement of the step that ensures it. */
export const waypointOptions = (predicates: readonly TPredicate[]): TComboboxOption[] =>
	predicates.flatMap(({ name, waypoint }) => (waypoint === undefined ? [] : [{ value: name, label: prettifyGwta(name), secondary: waypointMark(waypoint) }]));

/** What the steps read from the bar: its test-id prefix, the selected type, and the history in which callers open. */
type TActionsBarStepsDeps = { testIdPrefix: () => string; selectedLabel: () => string; history: ShuActivityHistory };

/** A step caller as the steps address it: whether it has run its step. */

export class ActionsBarSteps implements ReactiveController {
	readonly #host: TControllerHost;
	readonly #deps: TActionsBarStepsDeps;
	#steps: TStepDefinition[] = [];
	/** The heads of the waypoints actuality holds, offered beside the steps. */
	#heads: TComboboxOption[] = [];
	/** Whether the steps read last declare a step that sends a turn. A mode chosen before the steps are read waits for them. */
	#asks = false;
	/** The step the selector shows as chosen. */
	#chosen = "";

	constructor(host: TControllerHost, deps: TActionsBarStepsDeps) {
		this.#host = host;
		this.#deps = deps;
		host.addController(this);
		new StepsChangedController(host, () => this.load());
	}

	hostConnected(): void {
		this.#host.addEventListener(SHU_EVENT.STEP_SUCCESS, this.#onSettled);
		this.#host.addEventListener(SHU_EVENT.STEP_ERROR, this.#onSettled);
	}

	hostDisconnected(): void {
		this.#host.removeEventListener(SHU_EVENT.STEP_SUCCESS, this.#onSettled);
		this.#host.removeEventListener(SHU_EVENT.STEP_ERROR, this.#onSettled);
	}

	/** Whether actuality offers the step that sends a turn, which states whether a chosen Ask mode renders. */
	get offersAsk(): boolean {
		return this.#asks;
	}

	/** Read the steps actuality offers, and render with them. */
	async load(): Promise<void> {
		this.#steps = await getAvailableSteps();
		this.#heads = waypointOptions(await getAvailablePredicates());
		this.#asks = conversationSteps() !== undefined;
		this.#host.requestUpdate();
	}

	/** Select the step in the selector and open its caller with the options given. */
	pick(method: string, options: TStepOpening): void {
		this.#chosen = method;
		this.#host.requestUpdate();
		this.open(method, options);
	}

	/**
	 * Open a caller for the step at the end of the history. The last caller is removed first where it has not run and
	 * the new one doesn't carry fixed arguments, so a reader trying steps keeps one caller. A caller carries the method it
	 * calls and its number among the callers of that method, which its test ids carry. The newest caller is kept in view.
	 */
	open(method: string, { args, auto, values }: TStepOpening): void {
		const history = this.#deps.history;
		const last = history.querySelector<ShuStepCaller>(`${SHU_TAG.STEP_CALLER}:last-of-type`);
		if (last && !last.executed && !args && !auto) last.remove();
		const caller = document.createElement(SHU_TAG.STEP_CALLER) as ShuStepCaller;
		caller.setAttribute("step", method);
		caller.setAttribute("method", method);
		caller.setAttribute("call-index", String(history.querySelectorAll(`${SHU_TAG.STEP_CALLER}[method="${method}"]`).length));
		if (args) caller.setAttribute("params", JSON.stringify(args));
		if (auto) caller.setAttribute("auto", "");
		if (values) caller.values = values;
		history.append(caller);
	}

	/** Resolves a statement a reader typed to the step it states, and opens that step's caller with the statement's values,
	 *  which the reader checks before the call. A statement that doesn't resolve to one step states why in the history. */
	async #openStatement(text: string): Promise<void> {
		const resolved = await callStep<TStepValidation>(VALIDATE_STEP_METHOD, { text }, "resolve a typed statement");
		if (!resolved.ok) return this.#refuse(resolved.refusal);
		const validation = resolved.value;
		if (!validation.valid) return this.#refuse({ error: validation.error });
		this.pick(validation.method, { values: validation.values });
	}

	/** States a refusal in the history, where the reader's step callers show theirs. */
	#refuse(refusal: TPageRefusal): void {
		const shown = document.createElement(SHU_TAG.REFUSAL) as ShuRefusal;
		shown.refusal = refusal;
		this.#deps.history.append(shown);
	}

	/** The step mode's input line: the mode toggle, and the step selector once actuality offers steps, those for the selected
	 *  type first. */
	template(modeToggle: TemplateResult): TemplateResult {
		const label = this.#deps.selectedLabel();
		const selector =
			this.#steps.length > 0
				? html`<shu-combobox class="step-combo"
					testid=${`${this.#deps.testIdPrefix()}step-select`}
					placeholder="type a step or a statement"
					.options=${[...stepOptions(this.#steps, label ? stepsForContext(label) : []), ...this.#heads]}
					.value=${this.#chosen}
					.accepts=${true}
					@combo-change=${this.#onComboChange}></shu-combobox>`
				: nothing;
		return html`
			<div class="input-line">
				${modeToggle}
				${selector}
			</div>`;
	}

	/** Filters the steps by `text`, as the reader typing it in the step selector does. */
	enter(text: string): void {
		const selector = this.#host.renderRoot.querySelector<ShuCombobox>(".step-combo");
		if (!selector) throw new Error("step mode doesn't show a step selector until actuality offers steps");
		selector.enter(text);
	}

	/** A pick of a step opens its caller, and a pick of a waypoint's head the caller of the step that ensures it; text that doesn't
	 *  name either is a statement, resolved to the step it states. */
	#onComboChange = (e: CustomEvent): void => {
		const method = e.detail?.value;
		if (!method) return;
		if (this.#heads.some((head) => head.value === method)) return this.open(requireStep(ENSURE), { args: { outcome: method } });
		if (!this.#steps.some((step) => step.method === method)) return void this.#openStatement(method);
		this.#chosen = method;
		this.open(method, {});
	};

	/** A caller's result lands after it was opened and grows it in place, so the newest output is kept in view. */
	#onSettled = (): void => {
		this.#deps.history.keepNewestInView();
	};
}
