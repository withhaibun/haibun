/**
 * <shu-views-picker> — Lists available views (id, description) and opens one
 * on click via PaneState. Populated by the host via setViews().
 */
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { PaneState } from "../pane-state.js";

const ViewsPickerSchema = z.object({});

type TView = { id: string; description: string; component: string };

export class ShuViewsPicker extends ShuElement<typeof ViewsPickerSchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): unknown | null {
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
		super(ViewsPickerSchema, {});
	}

	setViews(views: TView[]): void {
		this.views = views;
	}

	private onPick = (v: TView) => (): void => {
		if (v.component) PaneState.request({ paneType: "component", tag: v.component, label: v.description });
	};

	render(): TemplateResult {
		return html`<ul class="views-list">${this.views.map(
			(v) => html`
			<li class="view-row" data-view-id=${v.id} data-component=${v.component} @click=${this.onPick(v)}>
				<span class="view-id">${v.id}</span>
				<span class="view-desc">${v.description}</span>
			</li>`,
		)}</ul>`;
	}
}

if (!customElements.get("shu-views-picker")) customElements.define("shu-views-picker", ShuViewsPicker);
