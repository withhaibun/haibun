/**
 * <shu-column-strip> — Horizontal scrolling container for column panes.
 * Manages pane insertion/removal via DOM API (NOT innerHTML).
 * Dispatches columns-changed, column-activated events.
 * Handles hash serialization via getColumnKeys/restoreColumn.
 */
import { html, css, type TemplateResult } from "lit";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { ColumnStripSchema } from "../schemas.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";
import { shuBaseStyles } from "./styles.js";
import type { ShuColumnPane } from "./shu-column-pane.js";

type PaneEl = ShuColumnPane & HTMLElement;
type SavedPaneState = { collapsed: boolean; minimized: boolean; inlineFlex: string; inlineDisplay: string };

/** Cookie holding the keys of user-minimized panes, so the minimize state survives a reload. */
const MINIMIZED_COOKIE = "shu-pane-min";

export class ShuColumnStrip extends ShuElement<typeof ColumnStripSchema> {
	static styles = [shuBaseStyles, css`
		:host { display: flex; flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; background: var(--shu-border); }
		::slotted(shu-column-pane) { background: var(--shu-bg); }
		@media (max-width: 600px), (orientation: portrait) {
			:host { flex-wrap: wrap; align-content: flex-start; overflow-y: auto; }
			::slotted([column-type="query"]) { flex: 0 0 100%; order: 0; height: 40vh; height: 40dvh; max-height: 75vh; max-height: 75dvh; }
			::slotted([column-type="query"].query-alone) { height: 100%; max-height: none; }
			::slotted(:not([column-type="query"])) { order: 1; flex: 1 1 200px; min-width: 200px; }
		}
	`];

	private savedLayout: Map<PaneEl, SavedPaneState> | null = null;

	constructor() {
		super(ColumnStripSchema, { activeIndex: -1 });
	}

	protected override onConnected(): void {
		this.autoListen(this, SHU_EVENT.COLUMN_CLOSE, this.handlePaneClose as EventListener);
		this.autoListen(this, SHU_EVENT.COLUMN_ACTIVATE, this.handlePaneActivate as EventListener);
		this.autoListen(this, SHU_EVENT.COLUMN_EXPAND, this.handlePaneExpand as EventListener);
		this.autoListen(this, SHU_EVENT.COLUMN_MAXIMIZE, this.handlePaneMaximize as EventListener);
		this.autoListen(this, SHU_EVENT.COLUMN_MINIMIZE, this.handlePaneMinimize as EventListener);
		this.updateQueryAlone();
		this.updateIsLast();
	}

	/** Get all child panes. */
	get panes(): PaneEl[] {
		return Array.from(this.querySelectorAll("shu-column-pane")) as PaneEl[];
	}

	/** Add a new pane. Appends at end (after afterIndex if given, for insertion order). A pane the user last minimized restores minimized and never takes activation. */
	addPane(pane: PaneEl, _afterIndex?: number): void {
		this.appendChild(pane);
		const restoreMinimized = getJsonCookie<string[]>(MINIMIZED_COOKIE, []).includes(this.paneKey(pane));
		if (restoreMinimized) pane.setAttribute(SHU_ATTR.DATA_MINIMIZED, "");
		else this.activatePane(this.panes.length - 1);
		this.updateQueryAlone();
		this.updateIsLast();
		this.updateAccordion();
		this.emitColumnsChanged();
		if (!restoreMinimized) requestAnimationFrame(() => pane.scrollIntoView({ behavior: "smooth", inline: "end" }));
	}

	private paneKey(p: PaneEl): string {
		return p.dataset.columnKey || `${p.getAttribute(SHU_ATTR.COLUMN_TYPE) || ""}:${p.getAttribute("label") || ""}`;
	}

	private persistMinimized(): void {
		setJsonCookie(MINIMIZED_COOKIE, this.panes.filter((p) => p.hasAttribute(SHU_ATTR.DATA_MINIMIZED)).map((p) => this.paneKey(p)));
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
		this.updateIsLast();
		this.updateAccordion();
		this.emitColumnsChanged();
	}

	/** Mark the rightmost pane with `is-last` so its resize handle and right border drop off. The pane reads the attribute via `:host([is-last])` selectors; no manual style edits per-pane. */
	private updateIsLast(): void {
		const panes = this.panes;
		for (let i = 0; i < panes.length; i++) {
			const isLast = i === panes.length - 1;
			panes[i].toggleAttribute(SHU_ATTR.IS_LAST, isLast);
			// The rightmost pane always absorbs the remaining strip width: an explicit width is meaningless there,
			// and keeping it (flex 0 0 px) would block shrinking and overflow the strip on narrow windows.
			if (isLast && panes[i].userWidth !== undefined) panes[i].setWidth(undefined);
		}
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
			new CustomEvent(SHU_EVENT.COLUMN_ACTIVATED, {
				detail: { index, label: panes[index]?.getAttribute("label") },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Get column labels for breadcrumb. */
	getColumnLabels(): string[] {
		return this.panes.filter((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) !== "query").map((p) => p.getAttribute("label") || "");
	}

	/** Serialize column state for URL hash. Appends ~min suffix for minimized panes. */
	getColumnKeys(): string[] {
		return this.panes
			.filter((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) !== "query")
			.map((p) => {
				const key = this.paneKey(p);
				if (p.hasAttribute(SHU_ATTR.DATA_MAXIMIZED)) return `${key}~max`;
				return p.hasAttribute(SHU_ATTR.DATA_MINIMIZED) ? `${key}~min` : key;
			});
	}

	/** Toggle query-alone class on the query pane for CSS-safe :only-child equivalent. */
	private updateQueryAlone(): void {
		const panes = this.panes;
		const queryPane = panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "query");
		if (queryPane) queryPane.classList.toggle("query-alone", panes.length === 1);
	}

	/** Collapse panes that don't fit, keeping active + query panes expanded. Collapses leftmost first. */
	updateAccordion(): void {
		if (this.isMaximized) return;
		const COLLAPSED_WIDTH = 32;
		const MIN_PANE_WIDTH = 200;
		const panes = this.panes;
		const stripWidth = this.clientWidth;
		// In portrait/wrap mode the flex-wrap CSS handles layout; accordion math assumes a single row.
		if (stripWidth <= 0 || panes.length <= 1 || window.matchMedia("(max-width: 600px), (orientation: portrait)").matches) return;

		const queryPane = panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "query");
		const activeIdx = this.state.activeIndex;

		// Expand auto-collapsed panes (skip user-minimized), then collapse from left until they fit
		const expandedWidth = stripWidth / Math.max(panes.length, 1);
		let usedWidth = 0;

		for (let i = 0; i < panes.length; i++) {
			if (panes[i].hasAttribute(SHU_ATTR.DATA_MINIMIZED)) {
				usedWidth += COLLAPSED_WIDTH;
			} else {
				panes[i].setCollapsed(false);
				// A user-resized pane occupies its explicit width; the rest share the strip evenly.
				usedWidth += panes[i].userWidth ?? Math.max(expandedWidth, MIN_PANE_WIDTH);
			}
		}

		// Collapse from left until they fit, skipping query, active, user-minimized, and user-resized
		// panes — an explicit resize is respected, so the strip scrolls rather than discarding it.
		for (let i = 0; i < panes.length && usedWidth > stripWidth; i++) {
			if (panes[i] === queryPane || i === activeIdx || panes[i].hasAttribute(SHU_ATTR.DATA_MINIMIZED) || panes[i].userWidth !== undefined) continue;
			panes[i].setCollapsed(true);
			usedWidth -= Math.max(expandedWidth, MIN_PANE_WIDTH) - COLLAPSED_WIDTH;
		}
	}

	private get isMaximized(): boolean {
		return this.panes.some((p) => p.hasAttribute(SHU_ATTR.DATA_MAXIMIZED));
	}

	private handlePaneMaximize = (e: Event): void => {
		const pane = (e as CustomEvent).target as PaneEl;
		const isMaximizing = pane.hasAttribute(SHU_ATTR.DATA_MAXIMIZED);
		if (isMaximizing) {
			// On maximize: every other pane is fully removed from layout (display:none),
			// not just collapsed. The maximizing pane takes the entire strip width — including
			// the query pane area. Snapshot the inline flex + display so un-maximize restores exactly what was there.
			this.savedLayout = new Map();
			for (const p of this.panes) this.savedLayout.set(p, { collapsed: p.isCollapsed, minimized: p.hasAttribute(SHU_ATTR.DATA_MINIMIZED), inlineFlex: p.style.flex, inlineDisplay: p.style.display });
			for (const p of this.panes) {
				if (p !== pane) p.style.display = "none";
				else {
					p.setCollapsed(false);
					p.style.display = "";
					p.style.flex = "1";
				}
			}
			const index = this.panes.indexOf(pane);
			if (index >= 0) this.activatePane(index);
		} else {
			if (this.savedLayout) {
				for (const [p, s] of this.savedLayout) {
					if (!this.contains(p)) continue;
					p.style.display = s.inlineDisplay;
					p.setCollapsed(s.collapsed);
					if (s.minimized) p.setAttribute(SHU_ATTR.DATA_MINIMIZED, "");
					p.style.flex = s.inlineFlex;
				}
				this.savedLayout = null;
			}
			this.updateIsLast();
			this.updateAccordion();
		}
		this.emitColumnsChanged();
	};

	private handlePaneExpand = (e: Event): void => {
		const pane = (e as CustomEvent).target as PaneEl;
		const index = this.panes.indexOf(pane);
		if (index >= 0) {
			pane.removeAttribute(SHU_ATTR.DATA_MINIMIZED);
			this.persistMinimized();
			this.activatePane(index);
			this.updateAccordion();
			// Mirror handlePaneMinimize: the `~min` suffix in column keys depends
			// on the pane's `data-minimized` attribute, so toggling it must emit
			// COLUMNS_CHANGED for the URL hash to track expand the same way it tracks minimize.
			this.emitColumnsChanged();
			requestAnimationFrame(() => pane.scrollIntoView({ behavior: "smooth", inline: "center" }));
		}
	};

	private handlePaneClose = (e: Event): void => {
		// Close requests route through PaneState (via app.ts), which owns the desired
		// set and the URL hash. The strip never removes panes on its own — reconcile does.
		const pane = (e as CustomEvent).target as PaneEl;
		const paneId = pane.dataset.columnKey ?? pane.getAttribute("column-type") ?? "";
		if (!paneId) return;
		this.dispatchEvent(new CustomEvent(SHU_EVENT.PANE_DISMISS, { detail: { paneId }, bubbles: true, composed: true }));
	};

	private handlePaneMinimize = (e: Event): void => {
		const event = e as CustomEvent<{ minimized: boolean }>;
		const panes = this.panes;
		const index = panes.indexOf(event.target as PaneEl);
		// A minimized column can't stay active: shift to the nearest expanded column to its right, else to its left.
		if (event.detail?.minimized && index === this.state.activeIndex) {
			const expanded = (p: PaneEl) => !p.hasAttribute(SHU_ATTR.DATA_MINIMIZED);
			let target = panes.findIndex((p, i) => i > index && expanded(p));
			if (target === -1) {
				for (let i = index - 1; i >= 0; i--) {
					if (expanded(panes[i])) {
						target = i;
						break;
					}
				}
			}
			if (target !== -1) this.activatePane(target);
		}
		this.persistMinimized();
		this.updateAccordion();
		this.emitColumnsChanged();
	};

	private handlePaneActivate = (e: Event): void => {
		const pane = (e as CustomEvent).target as PaneEl;
		const index = this.panes.indexOf(pane);
		if (index >= 0) this.activatePane(index);
	};

	private emitColumnsChanged(): void {
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.COLUMNS_CHANGED, {
				detail: { columns: this.getColumnLabels(), keys: this.getColumnKeys() },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onSlotChange = (): void => {
		this.updateQueryAlone();
		this.updateIsLast();
	};

	render(): TemplateResult {
		return html`<slot @slotchange=${this.onSlotChange}></slot>`;
	}
}
