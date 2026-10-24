/**
 * <shu-action-column>: an action a caller holds or a step requires, by what it allows: each step this page may call whose
 * required action it allows, read by core's `capabilityAllows`, the one reading every gate on a call uses. An action is
 * not a step: one action allows every step that requires it, a read at a level allows reads at narrower ones, and a
 * trailing `*` allows every action it begins. An action that doesn't allow a step this page may call states the steps
 * actuality declares that it allows. Either way the column states who holds the action here.
 */
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ActionSchema, type TAction } from "@haibun/core/lib/domains/actions.js";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import type { TStepMethod } from "@haibun/core/lib/steps/domains/step-method.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { availableStepsRead, declaredStepsAllowedBy, stepsAllowedBy } from "../controllers/registry-controller.js";
import { holderOf, type THolder } from "../controllers/authority-controller.js";
import { LoadController } from "../controllers/load-controller.js";
import type { TCallOutcome } from "../pipelines/call-step.js";
import { actionRef, recordRef, stepRef } from "./shu-ref.js";
import { loadRenders } from "./load-renders.js";
import "./shu-copy-button.js";

const StateSchema = z.object({ action: ActionSchema.or(z.literal("")) });

const IDS = SHU_TEST_IDS.ACTION_COLUMN;

/** What an action allows: the steps this page may call that it allows, or, where it doesn't allow one, the steps actuality declares
 *  that it allows. Either way, who holds it here. */
type TAllows = ({ allowed: TStepDefinition[] } | { requiring: TStepDefinition[] }) & { holder: THolder };

/** Who holds an action here: this page's key, with the delegation of the action to it where the page may read it, or, where the
 *  key doesn't hold it, a control that copies the action to request from a key that delegates it. */
export const holderTpl = (action: TAction, { holds, delegation }: THolder): TemplateResult =>
	html`<p data-testid=${IDS.HOLDS}>This page's key ${holds ? "holds" : "doesn't hold"} ${actionRef(action)}${
		holds
			? delegation
				? html`, delegated by ${recordRef(delegation, "its delegation")}.`
				: "."
			: html`. Request it from a key that delegates it. <shu-copy-button label="copy the action" title="copy the action to request" .source=${action}></shu-copy-button>`
	}</p>`;

export class ShuActionColumn extends ShuElement<typeof StateSchema> {
	/** The action, and the steps it allows. */
	summarizeForContext(): TLinkedData | null {
		const shown = this.#load.page;
		if (shown === undefined) return null;
		const { action } = this.state;
		const allows = "allowed" in shown ? shown.allowed.map((step) => step.method) : [];
		return { "@id": `action:${action}`, "@type": "hbn:Action", name: action, allows };
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; overflow: auto; font-size: var(--shu-font-md); }
			.action-column { padding: var(--shu-space-4); }
			h4 { margin: 0 0 var(--shu-space-3); font-size: var(--shu-font-lg); }
			ul { margin: 0; padding-left: var(--shu-space-5); }
		`,
	];

	constructor() {
		super(StateSchema, { action: "" });
	}

	/** The steps this page may call that the action allows, or, where it doesn't allow one, the steps actuality declares that it
	 *  allows, read where they're needed; and who holds it. */
	readonly #load = new LoadController<TAllows>(this, async (): Promise<TCallOutcome<TAllows>> => {
		const { action } = this.state;
		if (!action) throw new Error("<shu-action-column> reads before it is given an action");
		const available = await availableStepsRead();
		if (!available.ok) return available;
		const holder = await holderOf(action);
		const allowed = stepsAllowedBy(action);
		return { ok: true, value: allowed.length > 0 ? { allowed, holder } : { requiring: declaredStepsAllowedBy(action), holder } };
	});

	/** Called by the pane afterAttach hook with the action. */
	async open(action: TAction): Promise<void> {
		this.setState({ action });
		await this.#load.run();
	}

	render(): TemplateResult {
		return this.#load.render({ ...loadRenders(html`Reading what ${this.state.action} allows`, this.#load), completed: (shown) => this.renderAllows(shown) });
	}

	/** What the action allows, and who holds it here. */
	private renderAllows(shown: TAllows): TemplateResult {
		const { action } = this.state;
		if (!action) throw new Error("<shu-action-column> renders before it is given an action");
		return html`<div class="action-column" data-testid=${IDS.ROOT}>
				<h4><code>${action}</code></h4>
				${
					"allowed" in shown
						? html`<p>Allows these steps this page may call:</p>${stepList(shown.allowed, IDS.STEP)}`
						: html`<p>Doesn't allow a step this page may call. Steps actuality declares that it allows: ${shown.requiring.length}</p>${stepList(shown.requiring, IDS.REQUIRER)}`
				}
				${holderTpl(action, shown.holder)}
			</div>`;
	}
}

/** Steps, each linked by its method, with its line. */
const stepList = (steps: { method: TStepMethod; pattern: string }[], testId: string): TemplateResult =>
	html`<ul>${steps.map((step) => html`<li>${stepRef(step.method, step.method, testId)}: ${step.pattern}</li>`)}</ul>`;

defineElement(SHU_TAG.ACTION_COLUMN, ShuActionColumn);
