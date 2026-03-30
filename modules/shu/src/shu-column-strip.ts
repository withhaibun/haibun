/**
 * <shu-column-strip> — Horizontal scrolling container for column panes.
 * Manages pane insertion/removal via DOM API (NOT innerHTML).
 * Dispatches columns-changed, column-activated events.
 * Handles hash serialization via getColumnKeys/restoreColumn.
 */
import { ShuElement } from "./shu-element.js";
import { ColumnStripSchema } from "./schemas.js";
import type { ShuColumnPane } from "./shu-column-pane.js";

type PaneEl = ShuColumnPane & HTMLElement;

export class ShuColumnStrip extends ShuElement<typeof ColumnStripSchema> {
	constructor() {
		super(ColumnStripSchema, { activeIndex: -1 });
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener("column-close", this.handlePaneClose as EventListener);
		this.addEventListener("column-activate", this.handlePaneActivate as EventListener);
		this.addEventListener("column-expand", this.handlePaneExpand as EventListener);
		this.updateQueryAlone();
	}

	disconnectedCallback(): void {
		this.removeEventListener("column-close", this.handlePaneClose as EventListener);
		this.removeEventListener("column-activate", this.handlePaneActivate as EventListener);
		this.removeEventListener("column-expand", this.handlePaneExpand as EventListener);
	}

	/** Get all child panes. */
	get panes(): PaneEl[] {
		return Array.from(this.querySelectorAll("shu-column-pane")) as PaneEl[];
	}

	/** Add a new pane. Appends at end (after afterIndex if given, for insertion order). */
	addPane(pane: PaneEl, _afterIndex?: number): void {
		this.appendChild(pane);
		this.activatePane(this.panes.length - 1);
		this.updateQueryAlone();
		this.updateAccordion();
		this.emitColumnsChanged();
		requestAnimationFrame(() => pane.scrollIntoView({ behavior: "smooth", inline: "end" }));
	}

	/** Remove a pane by index. */
	removePane(index: number): void {
		const panes = this.panes;
		if (index < 0 || index >= panes.length) return;
		panes[index].remove();
		const remaining = this.panes;
		if (remaining.length === 0) {
			this.state = { ...this.state, activeIndex: -1 };
		} else if (this.state.activeIndex >= remaining.length) {
			this.activatePane(remaining.length - 1);
		}
		this.updateQueryAlone();
		this.updateAccordion();
		this.emitColumnsChanged();
	}

	/** Activate a pane by index. Updates active attributes without re-rendering other panes. */
	activatePane(index: number): void {
		const panes = this.panes;
		for (let i = 0; i < panes.length; i++) {
			panes[i].setActive(i === index);
		}
		this.state = { ...this.state, activeIndex: index };
		this.updateAccordion();
		this.dispatchEvent(
			new CustomEvent("column-activated", {
				detail: { index, label: panes[index]?.getAttribute("label") },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Get column labels for breadcrumb. */
	getColumnLabels(): string[] {
		return this.panes.filter((p) => p.getAttribute("column-type") !== "query").map((p) => p.getAttribute("label") || "");
	}

	/** Serialize column state for URL hash. */
	getColumnKeys(): string[] {
		return this.panes
			.filter((p) => p.getAttribute("column-type") !== "query")
			.map((p) => {
				const type = p.getAttribute("column-type") || "";
				const label = p.getAttribute("label") || "";
				const key = p.dataset.columnKey;
				return key || `${type}:${label}`;
			});
	}

	/** Toggle query-alone class on the query pane for CSS-safe :only-child equivalent. */
	private updateQueryAlone(): void {
		const panes = this.panes;
		const queryPane = panes.find((p) => p.getAttribute("column-type") === "query");
		if (queryPane) queryPane.classList.toggle("query-alone", panes.length === 1);
	}

	/** Collapse panes that don't fit, keeping active + query panes expanded. Collapses leftmost first. */
	updateAccordion(): void {
		const COLLAPSED_WIDTH = 32;
		const MIN_PANE_WIDTH = 200;
		const panes = this.panes;
		const stripWidth = this.clientWidth;
		// In portrait/wrap mode the flex-wrap CSS handles layout; accordion math assumes a single row.
		if (stripWidth <= 0 || panes.length <= 1 || window.matchMedia("(max-width: 600px), (orientation: portrait)").matches) return;

		const queryPane = panes.find((p) => p.getAttribute("column-type") === "query");
		const activeIdx = this.state.activeIndex;

		// Expand all panes, then collapse from left until they fit
		const expandedWidth = stripWidth / Math.max(panes.length, 1);
		let usedWidth = 0;

		for (let i = 0; i < panes.length; i++) {
			panes[i].setCollapsed(false);
			usedWidth += Math.max(expandedWidth, MIN_PANE_WIDTH);
		}

		// Collapse from left, skipping query and active panes
		for (let i = 0; i < panes.length && usedWidth > stripWidth; i++) {
			if (panes[i] === queryPane || i === activeIdx) continue;
			panes[i].setCollapsed(true);
			usedWidth -= Math.max(expandedWidth, MIN_PANE_WIDTH) - COLLAPSED_WIDTH;
		}
	}

	private handlePaneExpand = (e: Event): void => {
		const pane = (e as CustomEvent).target as PaneEl;
		const index = this.panes.indexOf(pane);
		if (index >= 0) {
			this.activatePane(index);
			this.updateAccordion();
			requestAnimationFrame(() => pane.scrollIntoView({ behavior: "smooth", inline: "center" }));
		}
	};

	private handlePaneClose = (e: Event): void => {
		const pane = (e as CustomEvent).target as PaneEl;
		const index = this.panes.indexOf(pane);
		if (index >= 0) this.removePane(index);
	};

	private handlePaneActivate = (e: Event): void => {
		const pane = (e as CustomEvent).target as PaneEl;
		const index = this.panes.indexOf(pane);
		if (index >= 0) this.activatePane(index);
	};

	private emitColumnsChanged(): void {
		this.dispatchEvent(
			new CustomEvent("columns-changed", {
				detail: { columns: this.getColumnLabels(), keys: this.getColumnKeys() },
				bubbles: true,
				composed: true,
			}),
		);
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.innerHTML = `
			<style>${STYLES}</style>
			<slot></slot>
		`;
	}
}

const STYLES = `
	:host {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow-x: auto;
		overflow-y: hidden;
		gap: 1px;
		background: #e0e0e0;
	}
	::slotted(shu-column-pane) {
		background: #fff;
	}
	@media (max-width: 600px), (orientation: portrait) {
		:host {
			flex-wrap: wrap;
			align-content: flex-start;
			overflow-y: auto;
		}
		::slotted([column-type="query"]) {
			flex: 0 0 100%;
			order: 0;
			height: 40vh;
			height: 40dvh;
			max-height: 75vh;
			max-height: 75dvh;
		}
		/* query-alone class set by JS — ::slotted(:only-child) compound selectors are unreliable in Safari */
		::slotted([column-type="query"].query-alone) {
			height: 100%;
			max-height: none;
		}
		::slotted(:not([column-type="query"])) {
			order: 1;
			flex: 1 1 200px;
			min-width: 200px;
		}
	}
`;
