/**
 * <shu-breadcrumb> — breadcrumb trail showing query context and open columns.
 * Extends ShuElement with BreadcrumbSchema.
 *
 * Trail: [query label] › [column 1] › [column 2] › ...
 * Clicking a crumb dispatches `breadcrumb-nav` with { index, subject }.
 * Sync indicator shown on query crumb when new data is available.
 */
import { ShuElement } from "./shu-element.js";
import { BreadcrumbSchema } from "../schemas.js";
import { esc, escAttr } from "../util.js";

export class ShuBreadcrumb extends ShuElement<typeof BreadcrumbSchema> {
	constructor() {
		super(BreadcrumbSchema, {
			queryLabel: "All",
			columns: [],
			activeIndex: 0,
			hasSync: false,
		});
	}

	/** Batch-update all properties and render once. */
	update(queryLabel: string, columns: string[], activeIndex: number): void {
		this.setState({
			queryLabel: queryLabel || "All",
			columns,
			activeIndex: Math.min(activeIndex, columns.length),
		});
	}

	/** Show or hide the sync-available indicator. */
	setSyncAvailable(available: boolean): void {
		if (this.state.hasSync === available) return;
		this.setState({ hasSync: available });
	}

	get activeIndex(): number {
		return this.state.activeIndex;
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener("mousedown", this.stopProp);
		this.addEventListener("touchstart", this.stopProp);
		this.shadowRoot?.addEventListener("click", this.handleClick);
	}

	disconnectedCallback(): void {
		this.removeEventListener("mousedown", this.stopProp);
		this.removeEventListener("touchstart", this.stopProp);
		this.shadowRoot?.removeEventListener("click", this.handleClick);
	}

	private stopProp = (e: Event): void => {
		const target = e.composedPath()[0] as HTMLElement | undefined;
		if (target?.closest?.(".crumb") || target?.closest?.(".sync-btn")) {
			e.stopPropagation();
		}
	};

	private handleClick = (e: Event): void => {
		const syncBtn = (e.target as HTMLElement).closest(".sync-btn");
		if (syncBtn) {
			e.stopPropagation();
			this.setState({ hasSync: false });
			this.dispatchEvent(new CustomEvent("sync-request", { bubbles: true, composed: true }));
			return;
		}

		const crumb = (e.target as HTMLElement).closest(".crumb") as HTMLElement | null;
		if (!crumb) return;
		e.stopPropagation();
		const idx = parseInt(crumb.dataset.index || "0", 10);
		this.setState({ activeIndex: idx });
		const subject = idx > 0 ? this.state.columns[idx - 1] : undefined;
		this.dispatchEvent(
			new CustomEvent("breadcrumb-nav", {
				bubbles: true,
				composed: true,
				detail: { index: idx, subject },
			}),
		);
	};

	protected render(): void {
		if (!this.shadowRoot) return;
		const { queryLabel, columns, activeIndex, hasSync } = this.state;
		const crumbs = [queryLabel, ...columns.map((c) => c.replace(/^Email:/, ""))];
		const syncBtn = hasSync ? '<button class="sync-btn" title="New data available — click to refresh">\u27F3</button>' : "";
		this.shadowRoot.innerHTML = `
			<style>${STYLES}</style>
			${crumbs
				.map((label, i) => {
					const cls = i === activeIndex ? "crumb active" : "crumb";
					const prefix = i === 0 ? syncBtn : "";
					return `<span class="${cls}" data-index="${i}" title="${escAttr(label)}">${prefix}${esc(label)}</span>`;
				})
				.join('<span class="crumb-sep">\u203A</span>')}
		`;
	}
}

const STYLES = `
	:host { display: flex; align-items: center; gap: 0; overflow: hidden; min-width: 0; flex: 1; }
	.crumb {
		cursor: pointer; color: #888; white-space: nowrap; overflow: hidden;
		text-overflow: ellipsis; max-width: 200px; padding: 1px 4px; border-radius: 3px;
	}
	.crumb:hover { color: #333; text-decoration: underline; }
	.crumb.active { background: #1a6b3c; color: #fff; font-weight: 500; }
	.crumb-sep { color: #ccc; padding: 0 2px; flex-shrink: 0; }
	.sync-btn {
		background: none; border: none; cursor: pointer; padding: 0 3px;
		color: #1a6b3c; font-weight: 700; font-size: inherit;
		animation: sync-pulse 2s ease-in-out infinite;
	}
	.sync-btn:hover { color: #0d4f2a; }
	@keyframes sync-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
`;
