/**
 * <shu-column-pane> — Resizable column container.
 * Uses <slot> for content projection. Active state via attribute (no re-render).
 * Resize drag handle on right edge. Dispatches column-close, column-resize events.
 */
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT, SHU_ATTR } from "../consts.js";
import { ColumnPaneSchema } from "../schemas.js";
import { esc } from "../util.js";

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
		this.updateActiveStyle();
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.updateActiveStyle();
	}

	/** Set active without full re-render — just toggle attribute + border. */
	setActive(active: boolean): void {
		if (this.state.active === active) return;
		this.state = { ...this.state, active };
		if (active) {
			this.setAttribute("active", "");
		} else {
			this.removeAttribute("active");
		}
		this.updateActiveStyle();
	}

	private updateActiveStyle(): void {
		const header = this.shadowRoot?.querySelector(".pane-header") as HTMLElement | null;
		if (!header) return;
		if (this.state.active) {
			this.style.borderTop = "2px solid #1a6b3c";
			header.style.background = "#e8f5e9";
			header.style.color = "#1a6b3c";
		} else {
			this.style.borderTop = "";
			header.style.background = "";
			header.style.color = "";
		}
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

		// Controls toggle — toggles data-show-controls on the slotted child view component
		this.shadowRoot.querySelector(".pane-controls")?.addEventListener("click", (e) => {
			e.stopPropagation();
			const child = this.children[0] as HTMLElement & { refresh?: () => void } | null;
			if (child) {
				const show = !child.hasAttribute(SHU_ATTR.SHOW_CONTROLS);
				if (show) child.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
				else child.removeAttribute(SHU_ATTR.SHOW_CONTROLS);
				child.refresh?.();
				(e.target as HTMLElement).classList.toggle("active", show);
			}
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

		this.updateActiveStyle();
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
	.pane-label {
		font-weight: 400;
		font-size: inherit;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}
	.pane-minimize {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.85em;
		padding: 0 4px;
		color: #bbb;
		flex-shrink: 0;
	}
	.pane-minimize:hover { color: #444; }
	:host([collapsed]) .pane-minimize { display: none; }
	.pane-maximize { background: none; border: none; cursor: pointer; font-size: 0.85em; padding: 0 4px; color: #bbb; flex-shrink: 0; }
	.pane-maximize:hover { color: #444; }
	:host([collapsed]) .pane-maximize { display: none; }
	:host([data-maximized]) .pane-maximize { color: #1a6b3c; }
	.pane-controls { background: none; border: none; cursor: pointer; font-size: 0.85em; padding: 0 4px; color: #bbb; flex-shrink: 0; }
	.pane-controls:hover { color: #444; }
	.pane-controls.active { color: #1a6b3c; }
	:host([collapsed]) .pane-controls { display: none; }
	.pane-pin {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.8em;
		padding: 0 2px;
		opacity: 0.3;
		transition: opacity 0.15s;
		flex-shrink: 0;
	}
	.pane-pin:hover { opacity: 0.7; }
	.pane-pin.pinned { opacity: 1; color: #1a6b3c; transform: rotate(45deg); }
	.pane-close {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.85em;
		padding: 0 4px;
		line-height: 1.4;
		color: #bbb;
		flex-shrink: 0;
	}
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
