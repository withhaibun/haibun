/**
 * <shu-artifact-frame>: an artifact under a caption bar, with a control that expands it. The artifact (an img, iframe, pre
 * or shu-product-view) is the frame's child, and shows through its slot. The `caption` attribute names it.
 */
import { html, css, unsafeCSS, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { SHU_ATTR, SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { shownOrReported } from "../controllers/artifact-controller.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";

/**
 * The frame's styles. An expanded frame's content is pinned to the document column's box on screen, which pinToColumn reads,
 * so it expands within the column rather than over the whole screen. While expanded, the content is a popover in the top
 * layer: inside a virtualized column every row is a stacking context positioned by a transform, so a z-index doesn't lift
 * the overlay above a later row's tiles, and the top layer renders above every stacking context. The host stays in its row
 * at the height it had, so the row keeps its height and the rows after it keep their places. The overlay's
 * right, bottom, padding, border and overflow replace the UA's centring of a popover.
 *
 * A caption without text keeps the fullscreen control and drops the bar's background and border, so it reads as a bare
 * toolbar. The step that took the artifact shows in reverse video at the foot of the expanded frame, as the polymorphic
 * view's step caption does, so the step holds one place as ←/→ moves between frames. The expanded image fills the overlay's
 * width and keeps its aspect ratio, and its maximum height keeps a tall image in view.
 *
 * A thumbnail takes the column's width: display: block stretches the frame to its `.thumb-row` grid track, or to the whole
 * column where it isn't grouped, and the slotted image fills the frame. An inline block would shrink to the image and leave
 * each tile small. A fixed aspect ratio reserves the tile's height before the image loads, so the block doesn't grow on
 * load and move the document's live edge out of view, and object-fit crops the screenshot to that box.
 */
const STYLES = `
:host { display: block; margin: var(--shu-space-6) 0 var(--shu-space-6) 32px; border: var(--shu-border-w) solid var(--shu-border); border-radius: 6px; overflow: hidden; }
:host(.fullscreen) .frame { position: fixed; top: var(--fs-top, 0); left: var(--fs-left, 0); right: auto; bottom: auto; width: var(--fs-width, 100vw); height: var(--fs-height, 100vh); margin: 0;
	padding: 0; border: none; border-radius: 0; overflow: hidden; color: inherit; background: var(--shu-bg); display: flex; flex-direction: column; }
.caption { display: flex; align-items: center; justify-content: space-between; font-family: var(--shu-font-family);
	font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: var(--shu-space-2) var(--shu-space-5);
	background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border); }
.caption.bare { background: none; border-bottom: none; padding: var(--shu-space-1) var(--shu-space-2); justify-content: flex-end; }
.step-caption { display: none; }
:host(.fullscreen) .step-caption:not(:empty) { display: block; position: absolute; left: 50%; bottom: var(--shu-space-5); transform: translateX(-50%); max-width: 90%; z-index: 1; pointer-events: none;
	background: var(--shu-fg); color: var(--shu-bg); font-weight: 600; font-family: var(--shu-font-family); font-size: var(--shu-font-md);
	padding: var(--shu-space-2) var(--shu-space-5); border-radius: var(--shu-radius); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fullscreen-btn { background: none; border: none; cursor: pointer; font-size: var(--shu-font-lg); color: var(--shu-fg-faded); padding: 0 var(--shu-space-2); }
.fullscreen-btn:hover { color: var(--shu-accent); }
.content { overflow: auto; }
:host(.fullscreen) .content { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
::slotted(img) { display: block; max-width: 100%; cursor: zoom-in; }
:host(.fullscreen) ::slotted(img) { width: 100%; max-width: 100%; max-height: 100%; height: auto; object-fit: contain; cursor: zoom-out; }
:host(.thumb) { display: block; margin: var(--shu-space-2) 0; }
:host(.thumb:not(.fullscreen)) ::slotted(img) { display: block; width: 100%; aspect-ratio: 16 / 10; height: auto; object-fit: cover; }
::slotted(iframe) { width: 100%; min-height: 200px; border: none; }
::slotted(pre) { margin: 0; padding: var(--shu-space-4) var(--shu-space-5); overflow-x: auto; }
`;

/** A class that marks an expanded frame, which the styles read. */
const FULLSCREEN = "fullscreen";

export class ShuArtifactFrame extends ShuElement<typeof EmptyStateSchema> {
	/** An artifact is part of the document that shows it, so the frame doesn't contribute to a conversation's context on its own. */
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
		// A virtualizer moves a row's elements as a reader scrolls, and an element taken out of the document leaves the top
		// layer, so an expanded frame enters it again where it is connected again.
		if (this.expanded) this.showInTopLayer();
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
		if (on && !this.expanded) this.style.height = `${this.getBoundingClientRect().height}px`;
		if (!on) this.style.removeProperty("height");
		this.expanded = on;
		this.classList.toggle(FULLSCREEN, on);
		if (on) this.showInTopLayer();
		else this.leaveTopLayer();
		if (!on) this.stepText = "";
		this.observeColumn(on);
		if (!on) return;
		this.pinToColumn();
		// The document column holds the time mapping and reads the frame's step id, so it moves the time cursor to this step.
		this.dispatchEvent(new CustomEvent(SHU_EVENT.CURSOR_TO_ROW, { detail: { row: this }, bubbles: true, composed: true }));
	}

	/** The element that holds the caption, the artifact and the step caption, which enters the top layer while expanded. */
	private frame(): HTMLElement {
		const frame = this.shadowRoot?.querySelector<HTMLElement>(".frame");
		if (!frame) throw new Error("<shu-artifact-frame> expands before it renders; expand it once it is connected");
		return frame;
	}

	/** Shows the frame's content in the top layer as a popover: the frame is inside a transformed virtualizer row, a stacking
	 *  context a z-index doesn't leave, so later rows' tiles would paint over it. "manual" keeps light dismiss off, so Escape
	 *  and the control close it. jsdom doesn't implement popover. */
	private showInTopLayer(): void {
		const frame = this.frame();
		if (typeof frame.showPopover !== "function") return;
		frame.setAttribute("popover", "manual");
		if (!frame.matches(":popover-open")) frame.showPopover();
	}

	/** Takes the frame's content out of the top layer. */
	private leaveTopLayer(): void {
		const frame = this.frame();
		if (!frame.hasAttribute("popover")) return;
		if (typeof frame.hidePopover === "function") frame.hidePopover();
		frame.removeAttribute("popover");
	}

	/** A press on the image itself expands or collapses the frame; an iframe, a pre or a link keeps its own behaviour. */
	private onContentClick = (e: Event): void => {
		if (e.composedPath().some((n) => n instanceof HTMLImageElement)) this.setFullscreen(!this.expanded);
	};

	render(): TemplateResult {
		return html`<div class="frame"><div class=${this.caption === "" ? "caption bare" : "caption"}>${this.caption === "" ? nothing : html`<span>${this.caption}</span>`}<button class="fullscreen-btn" title=${this.expanded ? "exit fullscreen (Esc)" : "fullscreen"} @click=${() => this.setFullscreen(!this.expanded)}>${this.expanded ? "\u2923" : "\u2922"}</button></div>
			<div class="content" @click=${this.onContentClick}><slot></slot></div>
			<div class="step-caption">${this.stepText}</div></div>`;
	}
}

defineElement(SHU_TAG.ARTIFACT_FRAME, ShuArtifactFrame);
