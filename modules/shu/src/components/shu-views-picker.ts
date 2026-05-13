/**
 * <shu-views-picker> — Lists available views (id, description) and opens one on
 * click via PaneState. Populated by the host via setViews().
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { PaneState } from "../pane-state.js";
import { esc } from "../util.js";

const ViewsPickerSchema = z.object({});

type TView = { id: string; description: string; component: string };

export class ShuViewsPicker extends ShuElement<typeof ViewsPickerSchema> {
	private views: TView[] = [];

	constructor() {
		super(ViewsPickerSchema, {});
	}

	setViews(views: TView[]): void {
		this.views = views;
		this.render();
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const rows = this.views
			.map(
				(v) => `
				<li class="view-row" data-view-id="${esc(v.id)}" data-component="${esc(v.component)}">
					<span class="view-id">${esc(v.id)}</span>
					<span class="view-desc">${esc(v.description)}</span>
				</li>`,
			)
			.join("");
		this.shadowRoot.innerHTML = `<style>${STYLES}</style><ul class="views-list">${rows}</ul>`;
		this.shadowRoot.querySelectorAll(".view-row").forEach((row) => {
			row.addEventListener("click", () => {
				const el = row as HTMLElement;
				const component = el.dataset.component ?? "";
				const description = el.querySelector(".view-desc")?.textContent ?? component;
				if (component) PaneState.request({ paneType: "component", tag: component, label: description });
			});
		});
	}
}

const STYLES = `
	:host { display: block; padding: 6px 8px; font-family: inherit; color: #222; }
	.views-list { list-style: none; margin: 0; padding: 0; }
	.view-row { display: flex; gap: 12px; padding: 4px 6px; cursor: pointer; border-bottom: 1px solid #eee; align-items: baseline; }
	.view-row:hover { background: #f5f5f5; }
	.view-id { font-weight: 600; color: #1a6b3c; min-width: 12em; }
	.view-desc { color: #555; font-size: 0.9em; }
`;

if (!customElements.get("shu-views-picker")) {
	customElements.define("shu-views-picker", ShuViewsPicker);
}
