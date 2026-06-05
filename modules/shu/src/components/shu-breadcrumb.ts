/**
 * <shu-breadcrumb> — breadcrumb trail showing query context and open columns.
 *
 * Trail: [query label] › [column 1] › [column 2] › ...
 * Clicking a crumb dispatches `breadcrumb-nav` with { index, subject }.
 * Sync indicator shown on the query crumb when new data is available.
 */
import { html, css, type TemplateResult } from "lit";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { BreadcrumbSchema } from "../schemas.js";

export class ShuBreadcrumb extends ShuElement<typeof BreadcrumbSchema> {
	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; align-items: center; gap: 0; overflow: hidden; min-width: 0; flex: 1; }
			.crumb { cursor: pointer; color: var(--shu-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; padding: var(--shu-space-1) var(--shu-space-2); border-radius: var(--shu-radius); }
			.crumb:hover { color: var(--shu-fg); text-decoration: underline; }
			.crumb.active { background: var(--shu-accent); color: var(--shu-accent-fg); font-weight: 500; }
			.crumb-sep { color: var(--shu-fg-faded); padding: 0 var(--shu-space-1); flex-shrink: 0; }
			.sync-btn { background: none; border: none; cursor: pointer; padding: 0 var(--shu-space-2); color: var(--shu-accent); font-weight: 700; font-size: inherit; animation: sync-pulse 2s ease-in-out infinite; }
			.sync-btn:hover { color: var(--shu-accent); filter: brightness(0.85); }
			@keyframes sync-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
		`,
	];

	constructor() {
		super(BreadcrumbSchema, { queryLabel: "All", columns: [], activeIndex: 0, hasSync: false });
	}

	/** Replace the trail in one batched mutation. Renamed from the original `update` to avoid clashing with Lit's reactive `update(changedProperties)` lifecycle method. */
	setTrail(queryLabel: string, columns: string[], activeIndex: number): void {
		this.setState({ queryLabel: queryLabel || "All", columns, activeIndex: Math.min(activeIndex, columns.length) });
	}

	/** Show or hide the sync-available indicator. */
	setSyncAvailable(available: boolean): void {
		if (this.state.hasSync === available) return;
		this.setState({ hasSync: available });
	}

	get activeIndex(): number {
		return this.state.activeIndex;
	}

	protected override onConnected(): void {
		// mousedown/touchstart inside a crumb must not bubble — the parent column-pane uses them to start a drag-resize, which would defeat the crumb click.
		this.autoListen(this, "mousedown", this.stopProp);
		this.autoListen(this, "touchstart", this.stopProp);
	}

	private stopProp = (e: Event): void => {
		const target = e.composedPath()[0] as HTMLElement | undefined;
		if (target?.closest?.(".crumb") || target?.closest?.(".sync-btn")) e.stopPropagation();
	};

	private onSync = (e: Event): void => {
		e.stopPropagation();
		this.setState({ hasSync: false });
		this.dispatchEvent(new CustomEvent("sync-request", { bubbles: true, composed: true }));
	};

	private onCrumb =
		(idx: number) =>
		(e: Event): void => {
			e.stopPropagation();
			this.setState({ activeIndex: idx });
			const subject = idx > 0 ? this.state.columns[idx - 1] : undefined;
			this.dispatchEvent(new CustomEvent("breadcrumb-nav", { bubbles: true, composed: true, detail: { index: idx, subject } }));
		};

	render(): TemplateResult {
		const { queryLabel, columns, activeIndex, hasSync } = this.state;
		const crumbs = [queryLabel, ...columns.map((c) => c.replace(/^Email:/, ""))];
		return html`${crumbs.map((label, i) => html`${i > 0 ? html`<span class="crumb-sep">›</span>` : ""}<span class=${i === activeIndex ? "crumb active" : "crumb"} data-index=${i} title=${label} @click=${this.onCrumb(i)}>${i === 0 && hasSync ? html`<button class="sync-btn" title="New data available — click to refresh" @click=${this.onSync}>⟳</button>` : ""}${label}</span>`)}`;
	}
}
