/**
 * <shu-artifact-frame> — Displays an artifact with caption bar and fullscreen toggle.
 * Uses a slot for content — wrap any artifact (img, iframe, pre, shu-product-view) inside.
 * Attributes: caption (display text).
 */
import { SHU_EVENT } from "../consts.js";

const STYLES = `
:host { display: block; margin: var(--shu-space-6) 0 var(--shu-space-6) 32px; border: var(--shu-border-w) solid var(--shu-border); border-radius: 6px; overflow: hidden; }
/* Expanded view is pinned to the DOCUMENT COLUMN's on-screen box (its rect, captured in pinToColumn) — not the whole
   viewport — so it expands within the column rather than floating centred over the entire screen. While expanded the
   frame is a POPOVER in the top layer: inside a virtualized column every row is a transform-positioned stacking context,
   so no z-index can lift the overlay above later sibling rows' tiles — the top layer is the platform's way out. The
   right:auto/bottom:auto/padding/border/overflow lines override the UA's [popover] centering defaults, which this
   pinned overlay replaces. */
:host(.fullscreen) { position: fixed; top: var(--fs-top, 0); left: var(--fs-left, 0); right: auto; bottom: auto; width: var(--fs-width, 100vw); height: var(--fs-height, 100vh); margin: 0;
	padding: 0; border: none; border-radius: 0; overflow: hidden; color: inherit; background: var(--shu-bg); display: flex; flex-direction: column; }
.caption { display: flex; align-items: center; justify-content: space-between; font-family: var(--shu-font-family);
	font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: var(--shu-space-2) var(--shu-space-5);
	background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border); }
/* No caption text (e.g. images): keep the fullscreen control but drop the bar's background/border so it reads as a bare toolbar. */
.caption.bare { background: none; border-bottom: none; padding: var(--shu-space-1) var(--shu-space-2); justify-content: flex-end; }
/* The step immediately preceding this thumbnail, shown reverse-video (same treatment as the polymorphic view #polymorphic-step caption)
   as a fixed strip at the BOTTOM of the screen, over the expanded image, ONLY while fullscreen — so the step context holds
   in a consistent place as ←/→ moves between frames and the document behind is covered. */
.step-caption { display: none; }
:host(.fullscreen) .step-caption:not(:empty) { display: block; position: absolute; left: 50%; bottom: var(--shu-space-5); transform: translateX(-50%); max-width: 90%; z-index: 1; pointer-events: none;
	background: var(--shu-fg); color: var(--shu-bg); font-weight: 600; font-family: var(--shu-font-family); font-size: var(--shu-font-md);
	padding: var(--shu-space-2) var(--shu-space-5); border-radius: var(--shu-radius); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fullscreen-btn { background: none; border: none; cursor: pointer; font-size: var(--shu-font-lg); color: var(--shu-fg-faded); padding: 0 var(--shu-space-2); }
.fullscreen-btn:hover { color: var(--shu-accent); }
.content { overflow: auto; }
:host(.fullscreen) .content { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
::slotted(img) { display: block; max-width: 100%; cursor: zoom-in; }
/* Expanded image fills the column-width overlay keeping its aspect ratio; max-height keeps a tall image fully in view. */
:host(.fullscreen) ::slotted(img) { width: 100%; max-width: 100%; max-height: 100%; height: auto; object-fit: contain; cursor: zoom-out; }
/* Thumbnail: an auxiliary screenshot that TAKES the column width. display:block (an inline-block would shrink-wrap to the
   image and never fill its cell) so the frame stretches to its .thumb-row grid track — or, ungrouped, to the whole reading
   column — and the slotted image fills the frame (width 100%). Height is capped and cover-cropped so a row of them is a
   tidy band of equal tiles. A fixed pixel width, and inline-block + width auto, were the regression (each stayed small). */
:host(.thumb:not(.fullscreen)) { display: block; margin: var(--shu-space-2) 0; }
/* A fixed aspect-ratio RESERVES the tile's height before the image loads, so the block does not grow on load and shove the
   document's live edge out of view (which stalled the follow); object-fit crops the screenshot into that tidy box. */
:host(.thumb:not(.fullscreen)) ::slotted(img) { display: block; width: 100%; aspect-ratio: 16 / 10; height: auto; object-fit: cover; }
::slotted(iframe) { width: 100%; min-height: 200px; border: none; }
::slotted(pre) { margin: 0; padding: var(--shu-space-4) var(--shu-space-5); overflow-x: auto; }
`;

export class ShuArtifactFrame extends HTMLElement {
	private shadow: ShadowRoot;
	private onKeydown = (e: KeyboardEvent): void => {
		// Every frame listens on `document`; defaultPrevented stops the just-navigated-to frame's listener
		// from re-handling the same keypress (which would cascade ArrowRight straight to the last image).
		if (e.defaultPrevented || !this.classList.contains("fullscreen")) return;
		if (e.key === "Escape") e.preventDefault(), this.setFullscreen(false);
		else if (e.key === "ArrowLeft") e.preventDefault(), this.requestSibling(-1);
		else if (e.key === "ArrowRight") e.preventDefault(), this.requestSibling(1);
	};
	private columnResize?: ResizeObserver;
	// Re-pin on window resize while fullscreen (catches a window change that shifts the column without resizing it).
	private onReposition = (): void => {
		if (this.classList.contains("fullscreen")) this.pinToColumn();
	};

	/** The document column this frame lives in: the shadow host (shu-document-column), which is the scroll container. */
	private column(): HTMLElement | null {
		const root = this.getRootNode();
		return root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
	}

	/** Size + place the fullscreen overlay to the document column's on-screen box, so it expands WITHIN the column instead
	 *  of floating over the whole viewport. Viewport coordinates are exact here: while expanded the frame is a showing
	 *  popover, and a top-layer element's fixed containing block is the viewport — never a transformed virtualizer row. */
	private pinToColumn(): void {
		const r = this.column()?.getBoundingClientRect();
		if (!r) return;
		this.style.setProperty("--fs-top", `${r.top}px`);
		this.style.setProperty("--fs-left", `${r.left}px`);
		this.style.setProperty("--fs-width", `${r.width}px`);
		this.style.setProperty("--fs-height", `${r.height}px`);
	}

	/** While expanded, track the column itself resizing — a pane maximize / divider drag fires no window resize, so the
	 *  expanded thumbnail must follow the column's new size. Only the active fullscreen frame observes. */
	private observeColumn(on: boolean): void {
		if (!on) {
			this.columnResize?.disconnect();
			return;
		}
		const col = this.column();
		if (!col || typeof ResizeObserver === "undefined") return;
		this.columnResize ??= new ResizeObserver(() => {
			if (this.classList.contains("fullscreen")) this.pinToColumn();
		});
		this.columnResize.disconnect();
		this.columnResize.observe(col);
	}

	/** When fullscreen, ←/→ asks the document column for the previous/next thumbnail in the whole run. The column owns the
	 *  move: under virtualization only the visible window's frames exist in the DOM, so this frame cannot find an off-screen
	 *  sibling itself — the column knows every block, scrolls the target into existence and expands it. */
	private requestSibling(dir: number): void {
		this.dispatchEvent(new CustomEvent(SHU_EVENT.FRAME_NAV, { detail: { dir, from: this }, bubbles: true, composed: true }));
	}

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: "open" });
	}

	connectedCallback(): void {
		const caption = this.getAttribute("caption") ?? "";
		const captionHtml = caption ? `<span>${caption}</span>` : "";
		this.shadow.innerHTML = `<style>${STYLES}</style>
			<div class="caption${caption ? "" : " bare"}">${captionHtml}<button class="fullscreen-btn" title="fullscreen">\u2922</button></div>
			<div class="content"><slot></slot></div>
			<div class="step-caption"></div>`;
		this.shadow.querySelector(".fullscreen-btn")?.addEventListener("click", () => this.setFullscreen(!this.classList.contains("fullscreen")));
		// Clicking the image itself toggles fullscreen (composedPath sees the slotted <img> across the shadow boundary); iframes/pre/links are left to their own behaviour.
		this.shadow.querySelector(".content")?.addEventListener("click", (e) => {
			if (e.composedPath().some((n) => n instanceof HTMLImageElement)) this.setFullscreen(!this.classList.contains("fullscreen"));
		});
		document.addEventListener("keydown", this.onKeydown);
		window.addEventListener("resize", this.onReposition);
	}

	disconnectedCallback(): void {
		document.removeEventListener("keydown", this.onKeydown);
		window.removeEventListener("resize", this.onReposition);
	}

	/** Expand or collapse this frame. Public: the document column drives it for ←/→ navigation across the run. */
	setFullscreen(on: boolean): void {
		this.classList.toggle("fullscreen", on);
		// The expanded overlay renders in the TOP LAYER (popover): the frame sits inside a transform-positioned virtualizer
		// row, a stacking context no z-index escapes, so without this the tiles of later rows paint over the enlargement.
		// "manual" keeps light-dismiss off — Escape and the fullscreen button own closing. Guarded for jsdom (no popover).
		if (on && typeof this.showPopover === "function") {
			this.setAttribute("popover", "manual");
			this.showPopover();
		} else if (!on && this.hasAttribute("popover")) {
			if (typeof this.hidePopover === "function") this.hidePopover();
			this.removeAttribute("popover");
		}
		// The step this thumbnail belongs to is STAMPED on the frame at document build (data-step-label / data-step-id):
		// under virtualization the step's block may not even exist in the DOM, so it cannot be found by walking siblings.
		const stepEl = this.shadow.querySelector(".step-caption");
		if (stepEl) stepEl.textContent = on ? (this.getAttribute("data-step-label") ?? "") : ""; // shown only while fullscreen
		this.observeColumn(on); // follow the column resizing/maximizing while expanded; stop on exit
		if (on) {
			this.pinToColumn(); // expand within the document column's box, not the whole viewport
			// Ask the owning document column to move the global time cursor to this thumbnail's step: a proper cursor-set
			// call through the column, which owns the time mapping and resolves the frame's stamped step id.
			this.dispatchEvent(new CustomEvent(SHU_EVENT.CURSOR_TO_ROW, { detail: { row: this }, bubbles: true, composed: true }));
		}
		const btn = this.shadow.querySelector(".fullscreen-btn");
		if (btn) {
			btn.textContent = on ? "\u2923" : "\u2922";
			btn.setAttribute("title", on ? "exit fullscreen (Esc)" : "fullscreen");
		}
	}
}

if (!customElements.get("shu-artifact-frame")) customElements.define("shu-artifact-frame", ShuArtifactFrame);
