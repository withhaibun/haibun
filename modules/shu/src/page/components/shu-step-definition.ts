/**
 * <shu-step-definition>: one step as actuality declares it. Its line, what it does, the stepper that declares it, the
 * domain of each argument and of what it returns, the action a caller holds to call it, and the host on which it runs. Each
 * domain links to its view, so a reader follows a step to the domains it joins and from a domain to the steps that
 * take and make it. A step the page may call can be chosen in the actions bar from here; for a step the page can't call,
 * this view states the action the page lacks and who holds it, each linked.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import { StepMethodSchema, type TStepMethod } from "@haibun/core/lib/steps/domains/step-method.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { declaredStepRead } from "../controllers/registry-controller.js";
import { holderOf, pageHolds, type THolder } from "../controllers/authority-controller.js";
import { lackedAction, type TAction } from "@haibun/core/lib/domains/actions.js";
import { LoadController } from "../controllers/load-controller.js";
import type { TCallOutcome } from "../pipelines/call-step.js";
import { actionRef, domainRef, originLink } from "./shu-ref.js";
import { loadRenders } from "./load-renders.js";
import { holderTpl } from "./shu-action-column.js";

const StateSchema = z.object({ method: StepMethodSchema.or(z.literal("")) });

const IDS = SHU_TEST_IDS.STEP_DEFINITION;

/** What the pane shows of its step: the step as actuality declares it, and, for a step this page can't call, the action the page
 *  lacks to call it and who holds that action here. */
type TShown = { step: TStepDefinition; lacks?: { action: TAction; holder: THolder } };

export class ShuStepDefinition extends ShuElement<typeof StateSchema> {
	/** The step as a prov:Plan: what a caller runs to reach its product. */
	summarizeForContext(): TLinkedData | null {
		const shown = this.#load.page;
		if (shown === undefined) return null;
		const { step } = shown;
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

	/** The step under this pane's method as actuality declares it, read where it's needed, with the action the page lacks to call
	 *  it where the page can't. A method actuality doesn't declare is refused, named. */
	readonly #load = new LoadController<TShown>(this, async (): Promise<TCallOutcome<TShown>> => {
		const { method } = this.state;
		if (!method) throw new Error("<shu-step-definition> reads before it is given a step's method");
		const declared = await declaredStepRead(method);
		if (!declared.ok) return declared;
		const step = declared.value;
		if (step.callable) return { ok: true, value: { step } };
		// Actuality states which steps the page may call. The action the page lacks is the one its own holdings lack, or the step's.
		const lacked = lackedAction(pageHolds(), step);
		const action = lacked === undefined ? step.capability : lacked;
		return { ok: true, value: { step, lacks: { action, holder: await holderOf(action) } } };
	});

	/** Called by the pane afterAttach hook with the step's method. */
	async open(method: TStepMethod): Promise<void> {
		this.setState({ method });
		await this.#load.run();
	}

	private onChoose = (): void => {
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_CHOOSE, { detail: { method: this.state.method }, bubbles: true, composed: true }));
	};

	render(): TemplateResult {
		return this.#load.render({
			...loadRenders(html`Reading ${this.state.method}`, this.#load),
			completed: ({ step, lacks }) =>
				this.renderDefinition(step, {
					rows: this.rowsOf(step),
					after:
						lacks === undefined
							? html`<button type="button" class="primary" data-testid=${IDS.CHOOSE} @click=${this.onChoose}>Choose this step</button>`
							: html`<p data-testid=${IDS.LACKS}>This page can't call it: it doesn't hold ${actionRef(lacks.action)}.</p>${holderTpl(lacks.action, lacks.holder)}`,
				}),
		});
	}

	/** The domain of each argument and of what a step returns, whether it reads or acts, and where it runs. */
	private rowsOf(step: TStepDefinition): TemplateResult {
		return html`${Object.entries(step.paramDomains).map(
			([name, domain]) =>
				html`<dt>${name}</dt><dd data-testid=${IDS.PARAM}>${domainRef(domain)}${step.recordIds?.[name] ? html` of the type <code>{${step.recordIds[name]}}</code> names` : ""}</dd>`,
		)}
			${step.productsDomain ? html`<dt>Returns</dt><dd data-testid=${IDS.PRODUCTS}>${domainRef(step.productsDomain)}</dd>` : ""}
			${step.productsOf ? html`<dt>Returns</dt><dd data-testid=${IDS.PRODUCTS}>what its <code>{${step.productsOf}}</code> returns</dd>` : ""}
			<dt>Does</dt><dd>${step.read ? "reads, and actuality doesn't record the reading" : "acts, and actuality records it"}</dd>
			${step.remoteOrigin ? html`<dt>Runs at</dt><dd>${originLink(step.remoteOrigin)}</dd>` : ""}`;
	}

	/** A step's line, what it does, its stepper, method and the action it requires, its rows, and what follows. */
	private renderDefinition(step: TStepDefinition, { rows, after }: { rows: TemplateResult; after: TemplateResult }): TemplateResult {
		return html`<div class="step-definition" data-testid=${IDS.ROOT}>
			<h4><code data-testid=${IDS.PATTERN}>${step.pattern}</code></h4>
			${step.description ? html`<p>${step.description}</p>` : ""}
			<dl>
				<dt>Stepper</dt><dd>${step.stepperName}: ${step.stepperDescription}</dd>
				<dt>Method</dt><dd><code>${step.method}</code></dd>
				<dt>Requires</dt><dd>${actionRef(step.capability)}</dd>
				${rows}
			</dl>
			${after}
		</div>`;
	}
}

defineElement(SHU_TAG.STEP_DEFINITION, ShuStepDefinition);
