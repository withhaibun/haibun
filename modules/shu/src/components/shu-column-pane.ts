/**
 * <shu-column-pane> — Resizable column container. Uses <slot> for content
 * projection. Active state via attribute (no re-render). Resize drag handle
 * on right edge. Dispatches column-close, column-resize, column-minimize,
 * column-maximize, column-activate, column-expand events.
 *
 * The visual chrome is built entirely from `--shu-…` tokens (defined in styles.ts);
 * theme/scale/responsive shifts happen there, never inside this component.
 * Active toggle state (controls-on, maximized, pinned, minimized) is reflected
 * onto the host element as boolean attributes so CSS selectors highlight the
 * relevant button via `[aria-pressed=true]` from the SHU button base style.
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { ColumnPaneSchema } from "../schemas.js";
import { shuBaseStyles, shuIconButtonStyles } from "./styles.js";
import { readShowControlsCookie, writeShowControlsCookie } from "../show-controls.js";
export { readShowControlsCookie };

const ICON = { MIN: "―", MAX: "⤢", CONTROLS: "⚙", PIN: "📌", CLOSE: "×" } as const;
const CLASS = {
	MIN: "pane-minimize",
	MAX: "pane-maximize",
	CONTROLS: "pane-controls",
	PIN: "pane-pin",
	CLOSE: "pane-close",
	GROUP: "pane-controls-group",
	HEADER: "pane-header",
	LABEL: "pane-label",
	CONTENT: "pane-content",
	RESIZE: "resize-handle",
} as const;
const TEST_ID = { MAX: "pane-maximize", CONTROLS: "pane-controls-toggle", BROWSER_COLUMN: "browser-column" } as const;
const MIN_RESIZED_WIDTH = 120;

export class ShuColumnPane extends ShuElement<typeof ColumnPaneSchema> {
	static override observedHtmlAttributes = [SHU_ATTR.IS_LAST, SHU_ATTR.DATA_MAXIMIZED];

	static styles = [
		shuBaseStyles,
		shuIconButtonStyles,
		css`
		:host {
			display: flex; flex-direction: column;
			min-width: calc(var(--shu-space-6) * 4);
			min-height: 0; overflow: hidden; position: relative;
			flex: 1;
			background: var(--shu-bg);
		}
		:host([is-last]) .resize-handle { display: none; }
		:host([is-last]) { box-shadow: none; }
		:host([collapsed]) {
			flex: 0 0 auto;
			min-width: calc(var(--shu-icon-btn) + var(--shu-space-3) * 2);
			max-width: calc(var(--shu-icon-btn) + var(--shu-space-3) * 2);
			cursor: pointer;
			transition: max-width 0.2s ease, min-width 0.2s ease;
		}
		:host([collapsed]) .pane-content { display: none; }
		:host([collapsed]) .resize-handle { display: none; }
		:host([collapsed]) .pane-header {
			writing-mode: vertical-lr; text-orientation: mixed;
			padding: var(--shu-space-4) var(--shu-space-2);
			flex: 1;
		}
		:host([collapsed]) .pane-controls-group { writing-mode: horizontal-tb; flex-direction: column; margin-left: 0; margin-top: var(--shu-space-3); }
		:host([collapsed]) .pane-controls-group > button { display: none; }
		:host([collapsed]) .pane-controls-group > button.pane-close,
		:host([collapsed]) .pane-controls-group > button.pane-pin { display: inline-flex; }
		:host([column-type="query"]) { position: sticky; left: 0; z-index: 1; background: var(--shu-bg); }
		.pane-header {
			display: flex; align-items: center;
			min-height: var(--shu-row-h);
			padding: 0 var(--shu-space-3);
			background: var(--shu-bg-soft);
			color: var(--shu-fg-muted);
			font-size: var(--shu-font-sm);
			border-bottom: var(--shu-border-w) solid var(--shu-border);
			flex-shrink: 0;
			gap: var(--shu-space-2);
		}
		.pane-header.empty { display: none; }
		:host([active]) { box-shadow: inset 0 2px 0 0 var(--shu-accent); }
		:host([active]) .pane-header { background: var(--shu-accent-soft); color: var(--shu-accent); }
		.pane-label {
			font-weight: 500;
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
			flex: 1; min-width: 0;
		}
		.pane-controls-group {
			display: inline-flex; align-items: center;
			gap: var(--shu-space-1);
			margin-left: auto;
			flex-shrink: 0;
		}
		.pane-controls-group > button.pane-close:hover {
			color: var(--shu-accent-fg);
			background: var(--shu-error);
			border-color: var(--shu-error);
		}
		.pane-content { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
		::slotted(*) { flex: 1; min-height: 0; overflow: auto; }
		.resize-handle {
			position: absolute; top: 0; right: 0;
			width: var(--shu-resize-w); height: 100%;
			cursor: col-resize; z-index: 4;
			background: transparent;
			touch-action: none;
		}
		.resize-handle::after {
			content: ""; position: absolute;
			top: 0; bottom: 0; right: 0;
			width: 2px;
			background: var(--shu-border-strong);
			pointer-events: none;
			transition: width 0.1s ease, background 0.1s ease;
		}
		.resize-handle:hover::after, .resize-handle.dragging::after { width: 4px; background: var(--shu-accent); }
		@media (max-width: 600px), (orientation: portrait) {
			:host { border-right: none; border-bottom: var(--shu-border-w) solid var(--shu-border); }
			:host([column-type="query"]) { position: static; min-width: 0; }
			.resize-handle { display: none; }
		}
	`,
	];

	constructor() {
		super(ColumnPaneSchema, { label: "", active: false, closable: true, pinned: false, columnType: "query" });
	}

	static attributeFields = { label: "label", active: "active", closable: "closable", pinned: "pinned", "column-type": "columnType" };

	/** Width, user-minimize, and pin are remembered per column across reloads (ShuElement.persistFields), keyed by the column's identity; `pinned` is a bidirectional attributeField, so restoring it re-asserts the `pinned` attribute pane-state's prune reads. Maximize is deliberately not remembered — it lives in the URL hash only. */
	static persistFields = ["width", "minimized", "pinned"] as const;

	/** A pane's persistence identity is its column key (assigned before attach by PaneState; "query" for the root pane). A pane without one doesn't persist. */
	protected override get persistKey(): string | null {
		return this.dataset.columnKey ?? null;
	}

	/** Transient accordion auto-collapse (strip layout), unioned with the persisted `minimized` state into the `collapsed` attribute. */
	#accordionCollapsed = false;

	get accordionCollapsed(): boolean {
		return this.#accordionCollapsed;
	}

	protected override onConnected(): void {
		this.#reflectLayout(); // persisted width/minimized restored just before this — reflect synchronously so the strip's addPane sees the attributes
		this.addEventListener("pointerdown", this.onPaneActivate, { capture: true });
	}

	protected override onDisconnected(): void {
		this.removeEventListener("pointerdown", this.onPaneActivate, { capture: true });
	}

	protected override onAttributeChanged(name: string): void {
		if (name === SHU_ATTR.IS_LAST || name === SHU_ATTR.DATA_MAXIMIZED) this.#reflectLayout();
	}

	/** Single writer of layout-derived DOM: the data-minimized attribute mirrors state for CSS and the strip's queries; collapsed is the union of user-minimize and accordion collapse; inline flex from #applyFlex. */
	#reflectLayout(): void {
		this.toggleAttribute(SHU_ATTR.DATA_MINIMIZED, this.state.minimized);
		this.toggleAttribute(SHU_ATTR.COLLAPSED, this.state.minimized || this.#accordionCollapsed);
		this.#applyFlex();
	}

	/** Inline flex computed from full state — one writer, so no path strands a stale width. Maximized fills the
	 * strip; collapsed defers to the :host([collapsed]) CSS; the rightmost pane absorbs the remaining strip width
	 * (its stored width stays put and reapplies when it stops being last); otherwise an explicit user width is
	 * fixed; default shares the strip via :host { flex: 1 }. */
	#applyFlex(): void {
		const w = this.state.width;
		if (this.hasAttribute(SHU_ATTR.DATA_MAXIMIZED)) this.style.flex = "1";
		else if (this.isCollapsed || w === undefined || this.hasAttribute(SHU_ATTR.IS_LAST)) this.style.flex = "";
		else this.style.flex = `0 0 ${w}px`;
	}

	/** Toggle active state. Reflects to the `[active]` host attribute so the `:host([active])` CSS rules apply without re-rendering, and dispatches `VIEW_ACTIVE` to the slotted child so it can adjust selection/update behavior. */
	setActive(active: boolean): void {
		if (this.state.active === active) return;
		this.setState({ active }); // the `active` attribute reflects automatically (bidirectional attributeFields)
		const child = this.firstElementChild;
		if (child) child.dispatchEvent(new CustomEvent(SHU_EVENT.VIEW_ACTIVE, { detail: { active } }));
	}

	/** Set user-resized width (persisted). Undefined = auto (flex: 1). */
	setWidth(width: number | undefined): void {
		this.setState({ width });
		this.#reflectLayout();
	}

	/** The width to count as fixed in strip layout math: the user's explicit width, except a last or maximized pane, which always renders flexible (the stored width stays put for when it isn't). */
	get fixedWidth(): number | undefined {
		return this.hasAttribute(SHU_ATTR.IS_LAST) || this.hasAttribute(SHU_ATTR.DATA_MAXIMIZED) ? undefined : this.state.width;
	}

	/** Accordion auto-collapse (strip layout only). User minimize goes through setMinimized. */
	setCollapsed(collapsed: boolean): void {
		this.#accordionCollapsed = collapsed;
		this.#reflectLayout();
	}

	get isCollapsed(): boolean {
		return this.hasAttribute(SHU_ATTR.COLLAPSED);
	}

	/** User-minimize (persisted). The one path that owns the minimize state — clicks, hash flags, and restores all land here. */
	setMinimized(minimized: boolean): void {
		if (this.state.minimized === minimized) return;
		this.setState({ minimized });
		this.#reflectLayout();
	}

	private onMinimize = (e: Event): void => {
		e.stopPropagation();
		const minimize = !this.state.minimized;
		this.setMinimized(minimize);
		this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MINIMIZE, { detail: { minimized: minimize }, bubbles: true, composed: true }));
	};

	private onMaximize = (e: Event): void => {
		e.stopPropagation();
		const maximize = !this.hasAttribute(SHU_ATTR.DATA_MAXIMIZED);
		if (maximize) this.setAttribute(SHU_ATTR.DATA_MAXIMIZED, "");
		else this.removeAttribute(SHU_ATTR.DATA_MAXIMIZED);
		this.requestUpdate();
		this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MAXIMIZE, { detail: { maximized: maximize }, bubbles: true, composed: true }));
	};

	private onControlsToggle = (e: Event): void => {
		e.stopPropagation();
		const child = this.children[0] as (HTMLElement & { refresh?: () => void }) | null;
		if (!child) return;
		const show = !child.hasAttribute(SHU_ATTR.SHOW_CONTROLS);
		if (show) child.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		else child.removeAttribute(SHU_ATTR.SHOW_CONTROLS);
		writeShowControlsCookie(child.tagName.toLowerCase(), show);
		child.refresh?.();
		this.requestUpdate();
	};

	private onPin = (e: Event): void => {
		e.stopPropagation();
		this.setState({ pinned: !this.state.pinned }); // the `pinned` attribute (read by pane-state's prune) reflects automatically
	};

	/** Closing is the reader dismissing this column, so its remembered width, minimize and pin go with it: a column
	 *  opened again at the same identity is a new one, and would otherwise arrive still pinned (or still minimized) from
	 *  a column the reader had closed. A pane removed by a prune or a reload keeps its memory — that is what it is for. */
	private onClose = (e: Event): void => {
		e.stopPropagation();
		this.forgetPersisted();
		this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_CLOSE, { bubbles: true, composed: true }));
	};

	// Activate on a press ANYWHERE in the pane, in the CAPTURE phase (bound in onConnected) so it fires before any
	// slotted content (entity links, graph nodes) can stopPropagation and swallow the activation — clicking the column
	// body focuses it, not just the empty chrome.
	private onPaneActivate = (): void => {
		if (!this.state.active) this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_ACTIVATE, { bubbles: true, composed: true }));
	};

	private onHeaderClick = (): void => {
		if (this.isCollapsed) this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_EXPAND, { bubbles: true, composed: true }));
	};

	private onSlotChange = (): void => {
		this.requestUpdate();
	};

	/** The widest this pane can render: the strip minus the minimum footprint the other panes need. Past this the strip
	 *  would overflow and the stored width would outrun what's actually shown — the drag keeps "growing" a width the
	 *  layout can't display, then feels dead on the way back until the excess unwinds. Clamping here keeps the handle
	 *  tracking the cursor. A collapsed/minimized sibling only needs its current sliver; any other needs a usable min. */
	#maxResizeWidth(): number {
		const strip = this.parentElement;
		if (!strip) return Number.POSITIVE_INFINITY;
		let othersMin = 0;
		for (const sib of Array.from(strip.children)) {
			if (sib === this) continue;
			othersMin += sib.hasAttribute(SHU_ATTR.COLLAPSED) || sib.hasAttribute(SHU_ATTR.DATA_MINIMIZED) ? (sib as HTMLElement).offsetWidth : MIN_RESIZED_WIDTH;
		}
		return Math.max(MIN_RESIZED_WIDTH, strip.clientWidth - othersMin);
	}

	private onResizeMouseDown = (e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as HTMLElement).classList.add("dragging");
		const startX = e.clientX;
		const startWidth = this.offsetWidth;
		const maxWidth = this.#maxResizeWidth();
		const move = (ev: MouseEvent) => this.setWidth(Math.min(maxWidth, Math.max(MIN_RESIZED_WIDTH, startWidth + (ev.clientX - startX))));
		const up = () => {
			document.removeEventListener("mousemove", move);
			document.removeEventListener("mouseup", up);
			this.shadowRoot?.querySelector(`.${CLASS.RESIZE}`)?.classList.remove("dragging");
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_RESIZE, { detail: { width: this.state.width }, bubbles: true, composed: true }));
		};
		document.addEventListener("mousemove", move);
		document.addEventListener("mouseup", up);
	};

	private onResizeTouchStart = (e: TouchEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as HTMLElement).classList.add("dragging");
		const startX = e.touches[0].clientX;
		const startWidth = this.offsetWidth;
		const maxWidth = this.#maxResizeWidth();
		const move = (ev: TouchEvent) => {
			ev.preventDefault();
			this.setWidth(Math.min(maxWidth, Math.max(MIN_RESIZED_WIDTH, startWidth + (ev.touches[0].clientX - startX))));
		};
		const end = () => {
			document.removeEventListener("touchmove", move);
			document.removeEventListener("touchend", end);
			this.shadowRoot?.querySelector(`.${CLASS.RESIZE}`)?.classList.remove("dragging");
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_RESIZE, { detail: { width: this.state.width }, bubbles: true, composed: true }));
		};
		document.addEventListener("touchmove", move, { passive: false });
		document.addEventListener("touchend", end);
	};

	render(): TemplateResult {
		const { label, closable, columnType, pinned } = this.state;
		const controlsActive = !!this.children[0]?.hasAttribute?.(SHU_ATTR.SHOW_CONTROLS);
		const maximized = this.hasAttribute(SHU_ATTR.DATA_MAXIMIZED);
		const isEmpty = !label && !closable;
		this.toggleAttribute(SHU_ATTR.DATA_CONTROLS_ON, controlsActive);
		this.toggleAttribute(SHU_ATTR.DATA_MAXIMIZED, maximized);
		const controlsGroup = isEmpty
			? nothing
			: html`<span class=${CLASS.GROUP}>
				<button class="pane-icon ${CLASS.MIN}" type="button" title="Minimize" aria-label="Minimize column" @click=${this.onMinimize}>${ICON.MIN}</button>
				<button class="pane-icon ${CLASS.MAX}" type="button" data-testid=${TEST_ID.MAX} title=${maximized ? "Restore" : "Maximize"} aria-label="Maximize column" aria-pressed=${maximized} @click=${this.onMaximize}>${ICON.MAX}</button>
				<button class="pane-icon ${CLASS.CONTROLS}" type="button" data-testid=${TEST_ID.CONTROLS} title=${controlsActive ? "Hide controls" : "Show controls"} aria-label="Toggle controls" aria-pressed=${controlsActive} @click=${this.onControlsToggle}>${ICON.CONTROLS}</button>
				<button class="pane-icon ${CLASS.PIN}" type="button" title=${pinned ? "Unpin column" : "Pin column"} aria-label="Pin column" aria-pressed=${pinned} @click=${this.onPin}>${ICON.PIN}</button>
				${closable ? html`<button class="pane-icon ${CLASS.CLOSE}" type="button" title="Close" aria-label="Close column" @click=${this.onClose}>${ICON.CLOSE}</button>` : nothing}
			</span>`;
		return html`
			<div class=${classMap({ [CLASS.HEADER]: true, empty: isEmpty })} data-testid=${columnType !== "query" ? TEST_ID.BROWSER_COLUMN : ""} @click=${this.onHeaderClick}>
				<span class=${CLASS.LABEL} title=${label}>${label}</span>
				${controlsGroup}
			</div>
			<div class=${CLASS.CONTENT}>
				<slot @slotchange=${this.onSlotChange}></slot>
			</div>
			<div class=${CLASS.RESIZE} @mousedown=${this.onResizeMouseDown} @touchstart=${this.onResizeTouchStart}></div>
		`;
	}
}
