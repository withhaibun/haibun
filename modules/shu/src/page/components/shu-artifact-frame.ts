/**
 * <shu-artifact-frame>: an artifact under a caption bar, with a control that expands it. The artifact (an img, iframe, pre
 * or shu-product-view) is the frame's child, and shows through its slot. The `caption` attribute names it.
 */
import { html, css, unsafeCSS, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { SHU_ATTR, SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { shownOrReported } from "../../artifact-url.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";

const STYLES = `
:host { display: block; margin: var(--shu-space-6) 0 var(--shu-space-6) 32px; border: var(--shu-border-w) solid var(--shu-border); border-radius: 6px; overflow: hidden; }
/* Expanded view is pinned to the DOCUMENT COLUMN's on-screen box (its rect, captured in pinToColumn), not the whole
   viewport: so it expands within the column rather than floating centred over the entire screen. While expanded the
   frame is a POPOVER in the top layer: inside a virtualized column every row is a transform-positioned stacking context,
   so a z-index can't lift the overlay above later sibling rows' tiles: the top layer renders above every stacking context. The
   right:auto/bottom:auto/padding/border/overflow lines override the UA's [popover] centering defaults, which this
   pinned overlay replaces. */
:host(.fullscreen) { position: fixed; top: var(--fs-top, 0); left: var(--fs-left, 0); right: auto; bottom: auto; width: var(--fs-width, 100vw); height: var(--fs-height, 100vh); margin: 0;
	padding: 0; border: none; border-radius: 0; overflow: hidden; color: inherit; background: var(--shu-bg); display: flex; flex-direction: column; }
.caption { display: flex; align-items: center; justify-content: space-between; font-family: var(--shu-font-family);
	font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: var(--shu-space-2) var(--shu-space-5);
	background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border); }
/* A caption without text (e.g. images): keep the fullscreen control but drop the bar's background/border so it reads as a bare toolbar. */
.caption.bare { background: none; border-bottom: none; padding: var(--shu-space-1) var(--shu-space-2); justify-content: flex-end; }
/* The step immediately preceding this thumbnail, shown reverse-video (same treatment as the polymorphic view #polymorphic-step caption)
   as a fixed strip at the BOTTOM of the screen, over the expanded image, ONLY while fullscreen, so the step context holds
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
   image and never fill its cell) so the frame stretches to its .thumb-row grid track, or, ungrouped, to the whole reading
   column: and the slotted image fills the frame (width 100%). Height is capped and cover-cropped so a row of them is a
   tidy band of equal tiles. A fixed pixel width, and inline-block + width auto, were the regression (each stayed small). */
:host(.thumb:not(.fullscreen)) { display: block; margin: var(--shu-space-2) 0; }
/* A fixed aspect-ratio RESERVES the tile's height before the image loads, so the block does not grow on load and shove the
   document's live edge out of view (which stalled the follow); object-fit crops the screenshot into that tidy box. */
:host(.thumb:not(.fullscreen)) ::slotted(img) { display: block; width: 100%; aspect-ratio: 16 / 10; height: auto; object-fit: cover; }
::slotted(iframe) { width: 100%; min-height: 200px; border: none; }
::slotted(pre) { margin: 0; padding: var(--shu-space-4) var(--shu-space-5); overflow-x: auto; }
`;

/** A class that marks an expanded frame, which the styles read. */
const FULLSCREEN = "fullscreen";

export class ShuArtifactFrame extends ShuElement<typeof EmptyStateSchema> {
	/** An artifact is part of the document that shows it, so the frame doesn't contribute to the Kihan's context on its own. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static styles = css`${unsafeCSS(STYLES)}`;

	/** The words that name the artifact; a frame without a caption shows a bare bar. */
	@property() accessor caption = "";
	/** The step that produced the artifact, which the expanded frame shows. */
	@state() private accessor stepText = "";
	@state() private accessor expanded = false;
	private columnResize?: ResizeObserver;

	constructor() {
		super(EmptyStateSchema);
	}

	private onKeydown = (e: KeyboardEvent): void => {
		// Every frame listens on `document`; defaultPrevented stops the frame a key moved to from moving again on the same
		// key, which would move ArrowRight straight to the last image.
		if (e.defaultPrevented || !this.expanded) return;
		if (e.key === "Escape") e.preventDefault(), this.setFullscreen(false);
		else if (e.key === "ArrowLeft") e.preventDefault(), this.requestSibling(-1);
		else if (e.key === "ArrowRight") e.preventDefault(), this.requestSibling(1);
	};

	/** Places the expanded frame again when the window resizes, which can move the column without resizing it. */
	private onReposition = (): void => {
		if (this.expanded) this.pinToColumn();
	};

	protected override onConnected(): void {
		this.autoListen(document, "keydown", this.onKeydown as EventListener);
		this.autoListen(window, "resize", this.onReposition);
		this.autoTeardown(() => this.columnResize?.disconnect());
		// Actuality serves an artifact only to a reader holding a private read, so what the frame holds shows what the page read.
		for (const media of this.querySelectorAll(`[${SHU_ATTR.DATA_ARTIFACT}]`)) {
			const path = media.getAttribute(SHU_ATTR.DATA_ARTIFACT);
			if (path === null) throw new Error(`<shu-artifact-frame> holds a ${SHU_ATTR.DATA_ARTIFACT} element without a path`);
			void shownOrReported(path, "shu-artifact-frame").then((at) => at && media.setAttribute("src", at));
		}
	}

	/** The document column the frame shows in: the shadow host, which is the scroll container. */
	private column(): HTMLElement | null {
		const root = this.getRootNode();
		return root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
	}

	/** Sizes and places the expanded frame to the document column's box on screen, so it expands within the column. Viewport
	 *  coordinates are exact, since the expanded frame is a popover in the top layer, whose fixed containing block is the
	 *  viewport rather than a transformed row. */
	private pinToColumn(): void {
		const r = this.column()?.getBoundingClientRect();
		if (!r) return;
		this.style.setProperty("--fs-top", `${r.top}px`);
		this.style.setProperty("--fs-left", `${r.left}px`);
		this.style.setProperty("--fs-width", `${r.width}px`);
		this.style.setProperty("--fs-height", `${r.height}px`);
	}

	/** While expanded, follows the column resizing: a pane maximize or a divider drag doesn't resize the window. */
	private observeColumn(on: boolean): void {
		if (!on) return this.columnResize?.disconnect();
		const col = this.column();
		if (!col || typeof ResizeObserver === "undefined") return;
		this.columnResize ??= new ResizeObserver(() => this.onReposition());
		this.columnResize.disconnect();
		this.columnResize.observe(col);
	}

	/** While expanded, ←/→ requests the previous or next thumbnail from the document column, which holds every block: under
	 *  virtualization only the shown window's frames are in the DOM. */
	private requestSibling(dir: number): void {
		this.dispatchEvent(new CustomEvent(SHU_EVENT.FRAME_NAV, { detail: { dir, from: this }, bubbles: true, composed: true }));
	}

	/** Sets the expanded caption to the text of the step that produced the artifact. The document column calls it when the
	 *  frame opens, because only the column reads a step row outside the rendered window. */
	showStep(text: string): void {
		this.stepText = text;
	}

	/** Expands or collapses the frame. The document column calls it for ←/→ across actuality. */
	setFullscreen(on: boolean): void {
		this.expanded = on;
		this.classList.toggle(FULLSCREEN, on);
		// The expanded frame renders in the top layer as a popover: the frame is inside a transformed virtualizer row, a
		// stacking context a z-index doesn't leave, so later rows' tiles would paint over it. "manual" keeps light dismiss
		// off, so Escape and the control close it. jsdom doesn't implement popover.
		if (on && typeof this.showPopover === "function") {
			this.setAttribute("popover", "manual");
			this.showPopover();
		} else if (!on && this.hasAttribute("popover")) {
			if (typeof this.hidePopover === "function") this.hidePopover();
			this.removeAttribute("popover");
		}
		if (!on) this.stepText = "";
		this.observeColumn(on);
		if (!on) return;
		this.pinToColumn();
		// The document column holds the time mapping and reads the frame's step id, so it moves the time cursor to this step.
		this.dispatchEvent(new CustomEvent(SHU_EVENT.CURSOR_TO_ROW, { detail: { row: this }, bubbles: true, composed: true }));
	}

	/** A press on the image itself expands or collapses the frame; an iframe, a pre or a link keeps its own behaviour. */
	private onContentClick = (e: Event): void => {
		if (e.composedPath().some((n) => n instanceof HTMLImageElement)) this.setFullscreen(!this.expanded);
	};

	render(): TemplateResult {
		return html`<div class=${this.caption === "" ? "caption bare" : "caption"}>${this.caption === "" ? nothing : html`<span>${this.caption}</span>`}<button class="fullscreen-btn" title=${this.expanded ? "exit fullscreen (Esc)" : "fullscreen"} @click=${() => this.setFullscreen(!this.expanded)}>${this.expanded ? "\u2923" : "\u2922"}</button></div>
			<div class="content" @click=${this.onContentClick}><slot></slot></div>
			<div class="step-caption">${this.stepText}</div>`;
	}
}

defineElement(SHU_TAG.ARTIFACT_FRAME, ShuArtifactFrame);
