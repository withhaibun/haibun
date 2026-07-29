/**
 * <shu-column-strip> — Horizontal scrolling container for column panes.
 * Manages pane insertion/removal via DOM API (NOT innerHTML).
 * Dispatches columns-changed, column-activated events.
 * Pane open-state and the URL hash are owned by PaneState; per-pane width/minimize
 * persistence is owned by the panes themselves (ShuElement.persistFields).
 */
import { html, css, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { ColumnStripSchema } from "../schemas.js";
import { activePane } from "../signals.js";
import { shuBaseStyles } from "./styles.js";
import type { ShuColumnPane } from "./shu-column-pane.js";

type PaneEl = ShuColumnPane & HTMLElement;

/** A pane's stable identity in the `activePane` signal: its columnKey, or its column-type for the query pane (which has none). */
const paneKeyOf = (pane: PaneEl): string => pane.dataset.columnKey ?? pane.getAttribute(SHU_ATTR.COLUMN_TYPE) ?? "";
/** Layout snapshot taken when a pane maximizes; restored on un-maximize. Flex is derived state (the pane recomputes it), so only display and accordion collapse are stashed. */
type SavedPaneState = { accordionCollapsed: boolean; inlineDisplay: string };

export class ShuColumnStrip extends ShuElement<typeof ColumnStripSchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
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
		super(ColumnStripSchema, {});
	}

	protected override onConnected(): void {
		this.autoListen(this, SHU_EVENT.COLUMN_CLOSE, this.handlePaneClose as EventListener);
		this.autoListen(this, SHU_EVENT.COLUMN_ACTIVATE, this.handlePaneActivate as EventListener);
		this.autoListen(this, SHU_EVENT.COLUMN_EXPAND, this.handlePaneExpand as EventListener);
		this.autoListen(this, SHU_EVENT.COLUMN_MAXIMIZE, this.handlePaneMaximize as EventListener);
		this.autoListen(this, SHU_EVENT.COLUMN_MINIMIZE, this.handlePaneMinimize as EventListener);
		// The active pane is the `activePane` signal; repaint the DOM active state whenever it changes (a click, a
		// restore, an open). Pane add/remove also repaints (see addPane/removePane), so a restore naming a not-yet-open
		// pane lands the moment that pane attaches.
		this.watchSignal(activePane, () => this.applyActive());
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
		this.ensureActive();
		this.applyActive(); // paint active from the signal now this pane exists (a restore that named it lands here)
		this.updateQueryAlone();
		this.updateIsLast();
		this.emitColumnsChanged();
		if (!minimized) requestAnimationFrame(() => pane.scrollIntoView({ behavior: "smooth", inline: "end" }));
		if (pane.hasAttribute(SHU_ATTR.DATA_MAXIMIZED)) this.applyMaximize(pane, true);
	}

	/** Remove a pane by index. */
	removePane(index: number): void {
		const panes = this.panes;
		if (index < 0 || index >= panes.length) return;
		const removedKey = paneKeyOf(panes[index]);
		panes[index].remove();
		const remaining = this.panes;
		// If the removed pane held focus, move it to the nearest remaining pane (the one now at its slot, else the last).
		if (activePane.get() === removedKey) activePane.set(remaining.length ? paneKeyOf(remaining[Math.min(index, remaining.length - 1)]) : null);
		this.ensureActive();
		this.applyActive();
		this.updateQueryAlone();
		this.updateIsLast();
		this.emitColumnsChanged();
	}

	/** Mark the rightmost pane with `is-last` so its resize handle and right border drop off and it renders flexible (the pane observes the attribute and recomputes its flex; its stored width is kept for when it stops being last). */
	private updateIsLast(): void {
		const panes = this.panes;
		for (let i = 0; i < panes.length; i++) panes[i].toggleAttribute(SHU_ATTR.IS_LAST, i === panes.length - 1);
	}

	/** Activate the pane at `index` by setting the shared `activePane` signal. The signal subscriber (applyActive) paints
	 *  the DOM state; every reader (harvest, isActiveView, dimming) derives from the same signal, so they cannot disagree. */
	activatePane(index: number): void {
		const pane = this.panes[index];
		if (pane) activePane.set(paneKeyOf(pane));
	}

	/**
	 * While panes are open, one of them is the pane you are on. The strip owns that invariant because it owns which
	 * panes exist: a pane can be added by a restore, a reconcile, or a step, and not every path names one.
	 *
	 * Only a signal naming NOTHING is repaired. A signal naming a pane that is not open yet is a restore in flight —
	 * it names the pane it is about to attach, and applyActive lands it the moment it does; claiming the first pane
	 * there would steal activation from the pane being restored.
	 */
	private ensureActive(): void {
		const panes = this.panes;
		if (panes.length === 0 || activePane.get() !== null) return;
		const takeable = panes.find((p) => !p.hasAttribute(SHU_ATTR.DATA_MINIMIZED)) ?? panes[0];
		activePane.set(paneKeyOf(takeable));
	}

	/** Paint the DOM active state from the `activePane` signal: exactly the pane whose key matches is active. Idempotent and
	 *  purely derived, so it is safe on every signal change and after any pane add/remove. */
	applyActive(): void {
		const key = activePane.get();
		for (const pane of this.panes) pane.setActive(paneKeyOf(pane) === key);
		this.updateAccordion();
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
		const activeIdx = panes.findIndex((p) => paneKeyOf(p) === activePane.get());

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
		if (event.detail?.minimized && paneKeyOf(panes[index]) === activePane.get()) {
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
