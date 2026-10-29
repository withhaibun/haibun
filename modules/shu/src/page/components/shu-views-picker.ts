/**
 * <shu-views-picker>: the views the domains declare, a row each (the domain it shows, and what it shows), as the page's catalog
 * declares them and actuality's domains describe them. A press on a row opens the view through the pane controller.
 */
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { ShuElement, type TLinkedData, EmptyStateSchema } from "./shu-element.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { shuBaseStyles } from "./styles.js";
import { requestPaneFrom } from "../controllers/pane-controller.js";
import { domainsRead } from "../controllers/registry-controller.js";
import { componentOfView, declaredViews as catalogViews } from "../controllers/catalog-controller.js";
import { LoadController } from "../controllers/load-controller.js";
import { addsToSelection } from "../derivations/pane-kinds.js";
import { declaredViews, type TDeclaredView } from "../derivations/declared-views.js";
import { refusalTpl } from "./load-renders.js";

export class ShuViewsPicker extends ShuElement<typeof EmptyStateSchema> {
	/** A control doesn't contribute to a conversation's context, since it isn't a view of data. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
		:host { display: block; padding: var(--shu-space-3) var(--shu-space-4); }
		.views-list { list-style: none; margin: 0; padding: 0; }
		.view-row {
			display: flex; gap: var(--shu-space-5); padding: var(--shu-space-2) var(--shu-space-3);
			cursor: pointer; border-bottom: var(--shu-border-w) solid var(--shu-border); align-items: baseline;
		}
		.view-row:hover { background: var(--shu-bg-hover); }
		.view-id { font-weight: 600; color: var(--shu-accent); min-width: 12em; }
		.view-desc { color: var(--shu-fg-muted); font-size: 0.9em; }
	`,
	];

	/** The views the picker lists, which the read of actuality's domains sets. */
	@property({ attribute: false }) accessor views: TDeclaredView[] = [];

	/** The read of actuality's domains, which describe the views the picker lists. */
	readonly #domains = new LoadController(this, domainsRead);

	constructor() {
		super(EmptyStateSchema);
	}

	protected override onConnected(): void {
		void this.#domains.run().then(() => {
			const read = this.#domains.page;
			if (read !== undefined) this.views = declaredViews(catalogViews(), componentOfView, read, SHU_TAG.VIEWS_PICKER);
		});
	}

	private onPick =
		(v: TDeclaredView) =>
		(e: MouseEvent): void => {
			requestPaneFrom(e, { paneType: "component", tag: v.component, label: v.description }, addsToSelection(e));
		};

	render(): TemplateResult {
		const refused = this.#domains.render<TemplateResult | string>({
			pending: () => "",
			running: () => "",
			completed: () => "",
			failed: (refusal) => refusalTpl(refusal, this.#domains),
		});
		return html`${refused}<ul class="views-list" data-testid=${SHU_TEST_IDS.VIEWS_PICKER.ROOT}>${this.views.map(
			(v) => html`
			<li class="view-row" data-testid=${`${SHU_TEST_IDS.VIEWS_PICKER.ROW}${v.component}`} data-view-id=${v.id} data-component=${v.component} @click=${this.onPick(v)}>
				<span class="view-id">${v.id}</span>
				<span class="view-desc">${v.description}</span>
			</li>`,
		)}</ul>`;
	}
}

defineElement(SHU_TAG.VIEWS_PICKER, ShuViewsPicker);
