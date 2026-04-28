/**
 * <shu-column-pane> — Resizable column container.
 * Uses <slot> for content projection. Active state via attribute (no re-render).
 * Resize drag handle on right edge. Dispatches column-close, column-resize events.
 */
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { ColumnPaneSchema } from "../schemas.js";
import { esc } from "../util.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";

const SHOW_CONTROLS_COOKIE = "shu-show-controls";

/** Read per-component show-controls preference. Components default to OFF — a fresh user sees graph/fisheye/etc. without their settings rows. */
export function readShowControlsCookie(componentTag: string): boolean {
	return Boolean(getJsonCookie<Record<string, boolean>>(SHOW_CONTROLS_COOKIE, {})[componentTag]);
}

function writeShowControlsCookie(componentTag: string, show: boolean): void {
	const map = getJsonCookie<Record<string, boolean>>(SHOW_CONTROLS_COOKIE, {});
	map[componentTag] = show;
	setJsonCookie(SHOW_CONTROLS_COOKIE, map);
}

export class ShuColumnPane extends ShuElement<typeof ColumnPaneSchema> {
	constructor() {
		super(ColumnPaneSchema, {
			label: "",
			active: false,
			closable: true,
			pinned: false,
			columnType: "query",
		});
	}

	static get observedAttributes(): string[] {
		return ["label", "active", "closable", "pinned", "column-type"];
	}

	attributeChangedCallback(name: string, _old: string | null, val: string | null): void {
		if (name === "label") {
			this.state = { ...this.state, label: val || "" };
			const header = this.shadowRoot?.querySelector(".pane-header");
			const span = this.shadowRoot?.querySelector(".pane-label");
			if (header) header.classList.toggle("empty", !val);
			if (span) {
				span.textContent = val || "";
				span.setAttribute("title", val || "");
			}
		}
		if (name === "active") this.state = { ...this.state, active: val !== null };
		if (name === "closable") this.state = { ...this.state, closable: val !== "false" };
		if (name === "pinned") this.state = { ...this.state, pinned: val !== null && val !== "false" };
		if (name === "column-type")
			this.state = {
				...this.state,
				columnType: (val as "query" | "entity" | "filter" | "property" | "monitor" | "sequence" | "document") || "query",
			};
	}

	/**
	 * Set active without full re-render. Toggles the `[active]` attribute; the
	 * `:host([active])` rules in the shadow stylesheet apply the highlight, so
	 * the visual is preserved across re-renders and unaffected by header-element
	 * timing.
	 */
	setActive(active: boolean): void {
		if (this.state.active === active) return;
		this.state = { ...this.state, active };
		if (active) {
			this.setAttribute("active", "");
		} else {
			this.removeAttribute("active");
		}
		// Mirror the TIME_SYNC fan-out pattern: notify the slotted view child so it can
		// switch between full-update behavior (active) and minimal sync-to-selection (inactive).
		const child = this.firstElementChild;
		if (child) child.dispatchEvent(new CustomEvent(SHU_EVENT.VIEW_ACTIVE, { detail: { active } }));
	}

	/** Set user-resized width. Undefined = auto (flex: 1). */
	setWidth(width: number | undefined): void {
		this.state = { ...this.state, width };
		if (width !== undefined) {
			this.style.flex = `0 0 ${width}px`;
		} else {
			this.style.flex = "1";
		}
	}

	/** Collapse to header-only (accordion). Content hidden, narrow width. */
	setCollapsed(collapsed: boolean): void {
		if (collapsed) {
			this.setAttribute("collapsed", "");
		} else {
			this.removeAttribute("collapsed");
		}
	}

	get isCollapsed(): boolean {
		return this.hasAttribute("collapsed");
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { label, closable } = this.state;

		this.shadowRoot.innerHTML = `
			<style>${STYLES}</style>
			<div class="pane-header${label || closable ? "" : " empty"}">
				<span class="pane-label" title="${esc(label)}">${esc(label)}</span>
				<button class="pane-minimize" title="Minimize">\u2015</button>
				<button class="pane-maximize" data-testid="pane-maximize" title="Maximize">\u2922</button>
				<button class="pane-controls${this.children[0]?.hasAttribute?.("data-show-controls") ? " active" : ""}" title="Toggle controls">\u2699</button>
				<button class="pane-pin${this.state.pinned ? " pinned" : ""}" title="${this.state.pinned ? "Unpin" : "Pin"}">\ud83d\udccc</button>
				${closable ? '<button class="pane-close" title="Close">\u00d7</button>' : ""}
			</div>
			<div class="pane-content">
				<slot></slot>
			</div>
			<div class="resize-handle"></div>
		`;

		// Sync the controls-toggle highlight from the slotted child once it's
		// appended. The render() above runs before openPinnedColumn finishes
		// `pane.appendChild(child)`, so `this.children[0]` doesn't yet have
		// `data-show-controls`. The slotchange event fires when the child is
		// distributed; reading the attr there gives an accurate initial state.
		const slot = this.shadowRoot.querySelector("slot");
		const ctrlBtn = this.shadowRoot.querySelector(".pane-controls") as HTMLElement | null;
		slot?.addEventListener("slotchange", () => {
			const child = this.children[0] as HTMLElement | undefined;
			if (ctrlBtn) ctrlBtn.classList.toggle("active", Boolean(child?.hasAttribute("data-show-controls")));
		});

		// Minimize toggle
		this.shadowRoot.querySelector(".pane-minimize")?.addEventListener("click", (e) => {
			e.stopPropagation();
			const minimize = !this.isCollapsed;
			this.setCollapsed(minimize);
			if (minimize) {
				this.setAttribute(SHU_ATTR.DATA_MINIMIZED, "");
			} else {
				this.removeAttribute(SHU_ATTR.DATA_MINIMIZED);
			}
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MINIMIZE, { bubbles: true, composed: true }));
		});

		// Maximize toggle
		this.shadowRoot.querySelector(".pane-maximize")?.addEventListener("click", (e) => {
			e.stopPropagation();
			const maximize = !this.hasAttribute(SHU_ATTR.DATA_MAXIMIZED);
			if (maximize) {
				this.setAttribute(SHU_ATTR.DATA_MAXIMIZED, "");
			} else {
				this.removeAttribute(SHU_ATTR.DATA_MAXIMIZED);
			}
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_MAXIMIZE, { bubbles: true, composed: true }));
		});

		// Controls toggle — toggles data-show-controls on the slotted child view
		// component AND persists the choice in a cookie keyed by the child's
		// tag, so a user who turns settings on for graph-view sees them again
		// on next reload without affecting fisheye or any other view.
		this.shadowRoot.querySelector(".pane-controls")?.addEventListener("click", (e) => {
			e.stopPropagation();
			const child = this.children[0] as (HTMLElement & { refresh?: () => void }) | null;
			if (!child) return;
			const show = !child.hasAttribute(SHU_ATTR.SHOW_CONTROLS);
			if (show) child.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
			else child.removeAttribute(SHU_ATTR.SHOW_CONTROLS);
			writeShowControlsCookie(child.tagName.toLowerCase(), show);
			child.refresh?.();
			(e.target as HTMLElement).classList.toggle("active", show);
		});

		// Pin toggle
		this.shadowRoot.querySelector(".pane-pin")?.addEventListener("click", (e) => {
			e.stopPropagation();
			const pinned = !this.state.pinned;
			this.state = { ...this.state, pinned };
			if (pinned) {
				this.setAttribute(SHU_ATTR.PINNED, "true");
			} else {
				this.removeAttribute(SHU_ATTR.PINNED);
			}
			const btn = e.target as HTMLElement;
			btn.classList.toggle("pinned", pinned);
			btn.title = pinned ? "Unpin column" : "Pin column";
		});

		// Close button
		this.shadowRoot.querySelector(".pane-close")?.addEventListener("click", (e) => {
			e.stopPropagation();
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_CLOSE, { bubbles: true, composed: true }));
		});

		// Resize handle
		const handle = this.shadowRoot.querySelector(".resize-handle") as HTMLElement | null;
		if (handle) {
			let startX = 0;
			let startWidth = 0;

			const onPointerMove = (clientX: number) => {
				const newWidth = Math.max(200, startWidth + (clientX - startX));
				this.setWidth(newWidth);
			};

			const onPointerUp = () => {
				document.removeEventListener("mousemove", mouseMove);
				document.removeEventListener("mouseup", mouseUp);
				document.removeEventListener("touchmove", touchMove);
				document.removeEventListener("touchend", onPointerUp);
				this.dispatchEvent(
					new CustomEvent(SHU_EVENT.COLUMN_RESIZE, {
						detail: { width: this.state.width },
						bubbles: true,
						composed: true,
					}),
				);
			};

			const mouseMove = (e: MouseEvent) => onPointerMove(e.clientX);
			const mouseUp = () => onPointerUp();
			const touchMove = (e: TouchEvent) => {
				e.preventDefault();
				onPointerMove(e.touches[0].clientX);
			};

			handle.addEventListener("mousedown", (e) => {
				e.preventDefault();
				startX = e.clientX;
				startWidth = this.offsetWidth;
				document.addEventListener("mousemove", mouseMove);
				document.addEventListener("mouseup", mouseUp);
			});

			handle.addEventListener(
				"touchstart",
				(e) => {
					e.preventDefault();
					startX = e.touches[0].clientX;
					startWidth = this.offsetWidth;
					document.addEventListener("touchmove", touchMove, { passive: false });
					document.addEventListener("touchend", onPointerUp);
				},
				{ passive: false },
			);
		}

		// Click pane body to activate
		this.shadowRoot.querySelector(".pane-content")?.addEventListener("click", () => {
			if (!this.state.active) {
				this.dispatchEvent(
					new CustomEvent(SHU_EVENT.COLUMN_ACTIVATE, {
						bubbles: true,
						composed: true,
					}),
				);
			}
		});

		// Click collapsed header to expand
		this.shadowRoot.querySelector(".pane-header")?.addEventListener("click", () => {
			if (this.isCollapsed) {
				this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_EXPAND, { bubbles: true, composed: true }));
			}
		});
	}
}

const STYLES = `
	:host {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		position: relative;
		flex: 1;
		min-width: 60px;
	}
	:host([collapsed]) {
		flex: 0 0 auto !important;
		min-width: 32px !important;
		max-width: 32px;
		cursor: pointer;
		transition: max-width 0.2s ease, min-width 0.2s ease;
	}
	:host([collapsed]) .pane-content {
		display: none;
	}
	:host([collapsed]) .resize-handle {
		display: none;
	}
	:host([collapsed]) .pane-header {
		writing-mode: vertical-lr;
		text-orientation: mixed;
		padding: 8px 4px;
		flex: 1;
	}
	:host([collapsed]) .pane-pin, :host([collapsed]) .pane-close {
		writing-mode: horizontal-tb;
		font-size: 0.75em;
		padding: 2px 0;
	}
	:host([column-type="query"]) {
		position: sticky;
		left: 0;
		z-index: 1;
		background: #fff;
	}
	.pane-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1px 8px;
		background: #fafafa;
		flex-shrink: 0;
		font-size: 0.85em;
		color: #888;
	}
	.pane-header:empty, .pane-header.empty { display: none; }
	:host([active]) { border-top: 2px solid #1a6b3c; }
	:host([active]) .pane-header { background: #e8f5e9; color: #1a6b3c; }
	.pane-label {
		font-weight: 400;
		font-size: inherit;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}
	/* Header buttons share one footprint and gap so active highlights line up
	 * across the row regardless of which buttons are toggled on. Inverse style
	 * (#1a6b3c / #fff) is the single "active" indicator — no transform tricks. */
	.pane-header > button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 18px;
		margin-left: 2px;
		padding: 0;
		font-size: 0.85em;
		line-height: 1;
		color: #bbb;
		background: none;
		border: none;
		border-radius: 3px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.pane-header > button:hover { color: #444; }
	:host([collapsed]) .pane-minimize,
	:host([collapsed]) .pane-maximize,
	:host([collapsed]) .pane-controls { display: none; }
	:host([data-maximized]) .pane-maximize { background: #1a6b3c; color: #fff; }
	.pane-controls.active { background: #1a6b3c; color: #fff; }
	.pane-pin { opacity: 0.5; transition: opacity 0.15s; }
	.pane-pin:hover { opacity: 0.85; }
	.pane-pin.pinned { opacity: 1; background: #1a6b3c; color: #fff; }
	.pane-close:hover { background: #eee; color: #444; }
	.pane-content {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	::slotted(*) {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.resize-handle {
		position: absolute;
		top: 0;
		right: 0;
		width: 4px;
		height: 100%;
		cursor: col-resize;
		z-index: 2;
	}
	.resize-handle:hover {
		background: rgba(0, 0, 0, 0.1);
	}
	@media (max-width: 600px), (orientation: portrait) {
		:host([column-type="query"]) {
			position: static;
			min-width: 0;
		}
	}
`;
