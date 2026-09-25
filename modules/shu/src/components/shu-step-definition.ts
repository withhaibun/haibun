/**
 * <shu-step-definition>: one step as the run declares it. Its line, what it does, the stepper that declares it, the
 * domain of each argument and of what it returns, the action a caller holds to call it, and the host it runs at. Each
 * domain links to its view, so a reader follows a step to the domains it joins and from a domain to the steps that
 * take and make it. The step can be chosen in the actions bar from here. The steps a page reads are the steps it may
 * call, so a step the run declares for other callers only is refused here, named.
 */
import { html, css, type TemplateResult } from "lit";
import { Task } from "@lit/task";
import { z } from "zod";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { getAvailableSteps } from "../rpc-registry.js";
import { actionRef, domainRef, originLink } from "./shu-ref.js";

const StateSchema = z.object({ method: z.string().default("") });

const IDS = SHU_TEST_IDS.STEP_DEFINITION;

export class ShuStepDefinition extends ShuElement<typeof StateSchema> {
	/** The step as a prov:Plan: what a caller runs to reach its product. */
	summarizeForKihan(): TLinkedData | null {
		const step = this.#load.value;
		if (!step) return null;
		return {
			"@id": `step:${step.method}`,
			"@type": "prov:Plan",
			name: step.pattern,
			...(step.description ? { description: step.description } : {}),
			paramDomains: step.paramDomains,
			...(step.productsDomain ? { productsDomain: step.productsDomain } : {}),
			...(step.productsOf ? { productsOf: step.productsOf } : {}),
			capability: step.capability,
		};
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; overflow: auto; font-size: var(--shu-font-md); }
			.step-definition { padding: var(--shu-space-4); }
			h4 { margin: 0 0 var(--shu-space-3); font-size: var(--shu-font-lg); }
			dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--shu-space-2) var(--shu-space-4); margin: var(--shu-space-4) 0; }
			dt { font-weight: 600; color: var(--shu-fg-muted); }
			dd { margin: 0; }
			.empty { padding: var(--shu-space-6); color: var(--shu-fg-faded); }
		`,
	];

	constructor() {
		super(StateSchema, { method: "" });
	}

	/** The step the run declares under this pane's method. A method no step answers to is refused, with the method named. */
	#load = new Task(this, {
		args: () => [this.state.method] as const,
		task: async ([method]): Promise<TStepDefinition | undefined> => {
			if (!method) return undefined;
			const step = (await getAvailableSteps()).find((declared) => declared.method === method);
			if (!step) throw new Error(`${method} is not among the steps this page may call`);
			return step;
		},
	});

	/** Called by the pane afterAttach hook with the step's method. */
	async open(method: string): Promise<void> {
		this.setState({ method });
		await this.updateComplete;
		await this.#load.taskComplete.catch(() => undefined);
	}

	private onChoose = (): void => {
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_CHOOSE, { detail: { method: this.state.method }, bubbles: true, composed: true }));
	};

	render(): TemplateResult {
		return this.#load.render({
			initial: () => html`<div class="empty"><shu-spinner></shu-spinner></div>`,
			pending: () => html`<div class="empty"><shu-spinner></shu-spinner> Reading ${this.state.method}…</div>`,
			error: (err) => html`<div class="empty error" data-testid=${IDS.ERROR}>${err instanceof Error ? err.message : String(err)}</div>`,
			complete: (step) => (step ? this.renderStep(step) : html``),
		});
	}

	private renderStep(step: TStepDefinition): TemplateResult {
		const params = Object.entries(step.paramDomains);
		return html`<div class="step-definition" data-testid=${IDS.ROOT}>
			<h4><code data-testid=${IDS.PATTERN}>${step.pattern}</code></h4>
			${step.description ? html`<p>${step.description}</p>` : ""}
			<dl>
				<dt>Stepper</dt><dd>${step.stepperName}: ${step.stepperDescription}</dd>
				<dt>Method</dt><dd><code>${step.method}</code></dd>
				${params.map(
					([name, domain]) =>
						html`<dt>${name}</dt><dd data-testid=${IDS.PARAM}>${domainRef(domain)}${step.recordIds?.[name] ? html` of the type <code>{${step.recordIds[name]}}</code> names` : ""}</dd>`,
				)}
				${step.productsDomain ? html`<dt>Returns</dt><dd data-testid=${IDS.PRODUCTS}>${domainRef(step.productsDomain)}</dd>` : ""}
				${step.productsOf ? html`<dt>Returns</dt><dd data-testid=${IDS.PRODUCTS}>what its <code>{${step.productsOf}}</code> returns</dd>` : ""}
				<dt>Requires</dt><dd>${actionRef(step.capability)}</dd>
				<dt>Does</dt><dd>${step.read ? "reads, and the run records no reading" : "acts, and the run records it"}</dd>
				${step.remoteOrigin ? html`<dt>Runs at</dt><dd>${originLink(step.remoteOrigin)}</dd>` : ""}
			</dl>
			<button type="button" class="primary" data-testid=${IDS.CHOOSE} @click=${this.onChoose}>Choose this step</button>
		</div>`;
	}
}
