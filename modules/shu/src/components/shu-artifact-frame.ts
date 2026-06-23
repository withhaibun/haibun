/**
 * <shu-artifact-frame> — Displays an artifact with caption bar and fullscreen toggle.
 * Uses a slot for content — wrap any artifact (img, iframe, pre, shu-product-view) inside.
 * Attributes: caption (display text).
 */
const STYLES = `
:host { display: block; margin: var(--shu-space-6) 0 var(--shu-space-6) 32px; border: var(--shu-border-w) solid var(--shu-border); border-radius: 6px; overflow: hidden; }
/* Expanded view is pinned to the DOCUMENT COLUMN's on-screen box (its rect, captured in pinToColumn) — not the whole
   viewport — so it expands within the column rather than floating centred over the entire screen. z-index stays BELOW the
   pane's right-edge resize handle (shu-column-pane .resize-handle is z-index 4) and the header controls, so the column
   can still be resized/maximized while a thumbnail is expanded; the fixed overlay covers the document content regardless. */
:host(.fullscreen) { position: fixed; top: var(--fs-top, 0); left: var(--fs-left, 0); width: var(--fs-width, 100vw); height: var(--fs-height, 100vh); z-index: 3; margin: 0; border-radius: 0;
	background: var(--shu-bg); display: flex; flex-direction: column; }
.caption { display: flex; align-items: center; justify-content: space-between; font-family: var(--shu-font-family);
	font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: var(--shu-space-2) var(--shu-space-5);
	background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border); }
/* No caption text (e.g. images): keep the fullscreen control but drop the bar's background/border so it reads as a bare toolbar. */
.caption.bare { background: none; border-bottom: none; padding: var(--shu-space-1) var(--shu-space-2); justify-content: flex-end; }
/* The step immediately preceding this thumbnail, shown reverse-video (same treatment as the fisheye #fisheye-step caption)
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
/* Thumbnail: keep auxiliary images (e.g. per-step screenshots) small so the step text stays prominent; click or ⤢ to view full. Left edge comes from the container, so the thumbnail aligns under its step. */
:host(.thumb:not(.fullscreen)) { display: inline-block; max-width: 320px; vertical-align: top; margin: var(--shu-space-2) 0; }
:host(.thumb:not(.fullscreen)) ::slotted(img) { width: 200px; height: 140px; object-fit: cover; }
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
		else if (e.key === "ArrowLeft") e.preventDefault(), this.showSibling(-1);
		else if (e.key === "ArrowRight") e.preventDefault(), this.showSibling(1);
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
	 *  of floating over the whole viewport. */
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

	/** When fullscreen, ←/→ moves to the previous/next image frame in the same document. */
	private showSibling(dir: number): void {
		const frames = (Array.from((this.getRootNode() as ParentNode).querySelectorAll("shu-artifact-frame")) as ShuArtifactFrame[]).filter((f) => f.querySelector("img"));
		const next = frames[frames.indexOf(this) + dir];
		if (!next) return;
		this.setFullscreen(false);
		next.setFullscreen(true);
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

	private setFullscreen(on: boolean): void {
		this.classList.toggle("fullscreen", on);
		const step = on ? this.precedingStepEl() : null;
		const stepEl = this.shadow.querySelector(".step-caption");
		if (stepEl) stepEl.textContent = step?.textContent?.trim() ?? ""; // populate only while fullscreen; emptied on exit
		this.observeColumn(on); // follow the column resizing/maximizing while expanded; stop on exit
		if (on) {
			this.pinToColumn(); // expand within the document column's box, not the whole viewport
			(step as HTMLElement | null)?.click(); // opening/advancing a thumbnail moves the global time cursor to its step (the step row owns startTime + the cursor setter)
		}
		const btn = this.shadow.querySelector(".fullscreen-btn");
		if (btn) {
			btn.textContent = on ? "\u2923" : "\u2922";
			btn.setAttribute("title", on ? "exit fullscreen (Esc)" : "fullscreen");
		}
	}

	/** The step element immediately preceding this thumbnail in document order — the step it logically relates to. Walk
	 *  back from the thumbnail's body-level container (its thumb-row when grouped, else its artifact container) to the
	 *  nearest step / prose / heading line, skipping other artifacts. That row carries both the caption text and (in the
	 *  document column) the click handler that moves the global time cursor to its data-raw-time. */
	private precedingStepEl(): Element | null {
		const container = this.closest(".thumb-row") ?? this.closest(".feature-artifacts, .standalone-artifact") ?? this;
		for (let el = container.previousElementSibling; el; el = el.previousElementSibling) {
			if (el.matches(".log-row, .prose-block, .header-block")) return el;
		}
		return null;
	}
}

if (!customElements.get("shu-artifact-frame")) customElements.define("shu-artifact-frame", ShuArtifactFrame);
