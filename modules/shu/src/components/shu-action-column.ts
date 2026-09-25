/**
 * <shu-action-column>: an action a caller holds or a step requires, by what it allows: each step this page may call whose
 * required action it allows, read by core's `capabilityAllows`, the one reading every gate on a call uses. An action is
 * not a step: one action allows every step that requires it, a read at a level allows reads at narrower ones, and a
 * trailing `*` allows every action it begins.
 */
import { html, css, type TemplateResult } from "lit";
import { Task } from "@lit/task";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { getAvailableSteps, stepsAllowedBy } from "../rpc-registry.js";
import { stepRef } from "./shu-ref.js";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";

const StateSchema = z.object({ action: z.string().default("") });

const IDS = SHU_TEST_IDS.ACTION_COLUMN;

export class ShuActionColumn extends ShuElement<typeof StateSchema> {
	/** The action, and the steps it allows. */
	summarizeForKihan(): TLinkedData | null {
		const allowed = this.#load.value;
		if (!allowed) return null;
		return { "@id": `action:${this.state.action}`, "@type": "hbn:Action", name: this.state.action, allows: allowed.map((step) => step.method) };
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

	#load = new Task(this, {
		args: () => [this.state.action] as const,
		task: async ([action]): Promise<TStepDefinition[] | undefined> => {
			if (!action) return undefined;
			await getAvailableSteps();
			return stepsAllowedBy(action);
		},
	});

	/** Called by the pane afterAttach hook with the action. */
	async open(action: string): Promise<void> {
		this.setState({ action });
		await this.updateComplete;
		await this.#load.taskComplete.catch(() => undefined);
	}

	render(): TemplateResult {
		const { action } = this.state;
		return this.#load.render({
			initial: () => html`<div class="empty"><shu-spinner></shu-spinner></div>`,
			pending: () => html`<div class="empty"><shu-spinner></shu-spinner> Reading what ${action} allows…</div>`,
			error: (err) => html`<div class="empty error">${err instanceof Error ? err.message : String(err)}</div>`,
			complete: (allowed) =>
				allowed
					? html`<div class="action-column" data-testid=${IDS.ROOT}>
							<h4><code>${action}</code></h4>
							${
								allowed.length
									? html`<p>Allows these steps this page may call:</p>
											<ul>${allowed.map((step) => html`<li>${stepRef(step.method, step.method, IDS.STEP)}: ${step.pattern}</li>`)}</ul>`
									: html`<p>Allows none of the steps this page may call.</p>`
							}
						</div>`
					: html``,
		});
	}
}
