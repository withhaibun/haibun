/**
 * <shu-column-strip> — Horizontal scrolling container for column panes.
 * Manages pane insertion/removal via DOM API (NOT innerHTML).
 * Dispatches columns-changed, column-activated events.
 * Pane open-state and the URL hash are owned by PaneState; per-pane width/minimize
 * persistence is owned by the panes themselves (ShuElement.persistFields).
 */
import { html, css, type TemplateResult } from "lit";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { ColumnStripSchema } from "../schemas.js";
import { shuBaseStyles } from "./styles.js";
import type { ShuColumnPane } from "./shu-column-pane.js";

type PaneEl = ShuColumnPane & HTMLElement;
/** Layout snapshot taken when a pane maximizes; restored on un-maximize. Flex is derived state (the pane recomputes it), so only display and accordion collapse are stashed. */
type SavedPaneState = { accordionCollapsed: boolean; inlineDisplay: string };

export class ShuColumnStrip extends ShuElement<typeof ColumnStripSchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): unknown | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
		/* The strip uses the browser's default scrollbar behaviour: the horizontal scrollbar only appears when the panes
		   genuinely overflow (rare — the accordion flex-shares them to fit). No reserved gutter, so there is never a
		   scrollbar track spanning the columns when nothing overflows. */
		/* isolation: column content must never paint above app chrome (the actions-bar overlay) no matter its internal
		   z-indexes — e.g. an embedded 3D scene's injected enter-VR button (z-index 9999) would otherwise intercept
		   clicks aimed at the expanded bar's bottom controls. */
		:host { display: flex; flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; background: var(--shu-border); isolation: isolate; }
		::slotted(shu-column-pane) { background: var(--shu-bg); }
		@media (max-width: 600px), (orientation: portrait) {
			:host { flex-wrap: wrap; align-content: flex-start; overflow-y: auto; }
			::slotted([column-type="query"]) { flex: 0 0 100%; order: 0; height: 40vh; height: 40dvh; max-height: 75vh; max-height: 75dvh; }
			::slotted([column-type="query"].query-alone) { height: 100%; max-height: none; }
			::slotted(:not([column-type="query"])) { order: 1; flex: 1 1 200px; min-width: 200px; }
		}
	`,
	];

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

	/** Add a new pane (appends at end). A pane arriving minimized — pre-marked by PaneState or restored from its persisted state on attach — never takes activation or scroll. */
	addPane(pane: PaneEl): void {
		this.appendChild(pane);
		const minimized = pane.hasAttribute(SHU_ATTR.DATA_MINIMIZED);
		if (!minimized) this.activatePane(this.panes.length - 1);
		this.updateQueryAlone();
		this.updateIsLast();
		this.updateAccordion();
		this.emitColumnsChanged();
		if (!minimized) requestAnimationFrame(() => pane.scrollIntoView({ behavior: "smooth", inline: "end" }));
		if (pane.hasAttribute(SHU_ATTR.DATA_MAXIMIZED)) this.applyMaximize(pane, true);
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

	/** Mark the rightmost pane with `is-last` so its resize handle and right border drop off and it renders flexible (the pane observes the attribute and recomputes its flex; its stored width is kept for when it stops being last). */
	private updateIsLast(): void {
		const panes = this.panes;
		for (let i = 0; i < panes.length; i++) panes[i].toggleAttribute(SHU_ATTR.IS_LAST, i === panes.length - 1);
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

	/** Toggle query-alone class on the query pane for CSS-safe :only-child equivalent. */
	private updateQueryAlone(): void {
		const panes = this.panes;
		const queryPane = panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "query");
		if (queryPane) queryPane.classList.toggle("query-alone", panes.length === 1);
	}

	/**
	 * Keep every column open, flex-sharing the strip — collapse one only when the columns that share the remaining
	 * width would each fall below a usable minimum (i.e. the strip is genuinely too narrow). Then collapse the
	 * FEWEST leftmost columns needed so the rest clear that minimum; never the query, active, user-minimized, or
	 * user-resized panes. A purposeful minimize is the user's; the accordion only touches auto-collapse.
	 */
	updateAccordion(): void {
		if (this.isMaximized) return;
		const COLLAPSED_WIDTH = 32;
		const MIN_USABLE_WIDTH = 150; // below this a flex-shared column is too thin to read — collapse instead of showing a sliver
		const panes = this.panes;
		const stripWidth = this.clientWidth;
		// In portrait/wrap mode the flex-wrap CSS handles layout; accordion math assumes a single row.
		if (stripWidth <= 0 || panes.length <= 1 || window.matchMedia("(max-width: 600px), (orientation: portrait)").matches) return;

		const queryPane = panes.find((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === "query");
		const activeIdx = this.state.activeIndex;

		// Start from everything-open: un-collapse every auto-collapsed pane (a user-minimized one stays minimized).
		for (const p of panes) if (!p.hasAttribute(SHU_ATTR.DATA_MINIMIZED)) p.setCollapsed(false);

		// Space the flex panes share = strip minus the slivers of minimized panes and the fixed widths of resized panes.
		let fixed = 0;
		let flexCount = 0;
		for (const p of panes) {
			if (p.hasAttribute(SHU_ATTR.DATA_MINIMIZED)) fixed += COLLAPSED_WIDTH;
			else if (p.fixedWidth !== undefined) fixed += p.fixedWidth;
			else flexCount++;
		}

		// Collapse leftmost flex panes (never query/active/minimized/resized) only while the remaining flex panes
		// can't each clear MIN_USABLE_WIDTH — and stop the moment they can, so the minimum number collapse.
		let avail = stripWidth - fixed;
		for (let i = 0; i < panes.length; i++) {
			if (flexCount <= 1 || avail / flexCount >= MIN_USABLE_WIDTH) break;
			const p = panes[i];
			if (p === queryPane || i === activeIdx || p.hasAttribute(SHU_ATTR.DATA_MINIMIZED) || p.fixedWidth !== undefined) continue;
			p.setCollapsed(true);
			avail -= COLLAPSED_WIDTH;
			flexCount--;
		}
	}

	private get isMaximized(): boolean {
		return this.panes.some((p) => p.hasAttribute(SHU_ATTR.DATA_MAXIMIZED));
	}

	private handlePaneMaximize = (e: Event): void => {
		const pane = (e as CustomEvent).target as PaneEl;
		this.applyMaximize(pane, pane.hasAttribute(SHU_ATTR.DATA_MAXIMIZED));
	};

	/** Maximize layout: every other pane is fully removed from layout (display:none), not just collapsed —
	 * the maximizing pane takes the entire strip width including the query pane area. The snapshot guard makes
	 * this idempotent: a re-application while already maximized (e.g. a PaneState reconcile re-affirming the
	 * flag) can never re-snapshot the hidden layout and corrupt the restore. The pane's flex is derived from
	 * its data-maximized attribute, so only display and accordion collapse need stashing. */
	applyMaximize(pane: PaneEl, maximizing: boolean): void {
		if (maximizing) {
			if (this.savedLayout) return;
			this.savedLayout = new Map();
			for (const p of this.panes) this.savedLayout.set(p, { accordionCollapsed: p.accordionCollapsed, inlineDisplay: p.style.display });
			for (const p of this.panes) {
				if (p !== pane) p.style.display = "none";
				else {
					p.setCollapsed(false);
					p.style.display = "";
				}
			}
			const index = this.panes.indexOf(pane);
			if (index >= 0) this.activatePane(index);
		} else {
			if (!this.savedLayout) return;
			for (const [p, s] of this.savedLayout) {
				if (!this.contains(p)) continue;
				p.style.display = s.inlineDisplay;
				p.setCollapsed(s.accordionCollapsed);
			}
			this.savedLayout = null;
			this.updateIsLast();
			this.updateAccordion();
		}
		this.emitColumnsChanged();
	}

	private handlePaneExpand = (e: Event): void => {
		const pane = (e as CustomEvent).target as PaneEl;
		const index = this.panes.indexOf(pane);
		if (index >= 0) {
			pane.setMinimized(false);
			this.activatePane(index);
			this.updateAccordion();
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
				detail: { columns: this.getColumnLabels() },
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
