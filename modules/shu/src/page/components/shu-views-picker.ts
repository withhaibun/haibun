/**
 * <shu-views-picker>: Lists available views (id, description) and opens one
 * on click through the pane controller. Populated by the host via setViews().
 */
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { ShuElement, type TLinkedData, EmptyStateSchema } from "./shu-element.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { shuBaseStyles } from "./styles.js";
import { requestPaneFrom } from "../controllers/pane-controller.js";
import { addsToSelection } from "../derivations/pane-kinds.js";

type TView = { id: string; description: string; component: string };

export class ShuViewsPicker extends ShuElement<typeof EmptyStateSchema> {
	/** A control doesn't contribute to the Kihan's context, since it isn't a view of data. */
	summarizeForKihan(): TLinkedData | null {
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

	@property({ attribute: false }) accessor views: TView[] = [];

	constructor() {
		super(EmptyStateSchema);
	}

	setViews(views: TView[]): void {
		this.views = views;
	}

	private onPick =
		(v: TView) =>
		(e: MouseEvent): void => {
			if (v.component) requestPaneFrom(e, { paneType: "component", tag: v.component, label: v.description }, addsToSelection(e));
		};

	render(): TemplateResult {
		return html`<ul class="views-list" data-testid=${SHU_TEST_IDS.VIEWS_PICKER.ROOT}>${this.views.map(
			(v) => html`
			<li class="view-row" data-testid=${`${SHU_TEST_IDS.VIEWS_PICKER.ROW}${v.component}`} data-view-id=${v.id} data-component=${v.component} @click=${this.onPick(v)}>
				<span class="view-id">${v.id}</span>
				<span class="view-desc">${v.description}</span>
			</li>`,
		)}</ul>`;
	}
}

defineElement(SHU_TAG.VIEWS_PICKER, ShuViewsPicker);
