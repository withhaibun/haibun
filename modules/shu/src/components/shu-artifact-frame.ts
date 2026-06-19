/**
 * <shu-artifact-frame> — Displays an artifact with caption bar and fullscreen toggle.
 * Uses a slot for content — wrap any artifact (img, iframe, pre, shu-product-view) inside.
 * Attributes: caption (display text).
 */
const STYLES = `
:host { display: block; margin: var(--shu-space-6) 0 var(--shu-space-6) 32px; border: var(--shu-border-w) solid var(--shu-border); border-radius: 6px; overflow: hidden; }
:host(.fullscreen) { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 100; margin: 0; border-radius: 0;
	background: var(--shu-bg); display: flex; flex-direction: column; }
.caption { display: flex; align-items: center; justify-content: space-between; font-family: var(--shu-font-family);
	font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: var(--shu-space-2) var(--shu-space-5);
	background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border); }
/* No caption text (e.g. images): keep the fullscreen control but drop the bar's background/border so it reads as a bare toolbar. */
.caption.bare { background: none; border-bottom: none; padding: var(--shu-space-1) var(--shu-space-2); justify-content: flex-end; }
.fullscreen-btn { background: none; border: none; cursor: pointer; font-size: var(--shu-font-lg); color: var(--shu-fg-faded); padding: 0 var(--shu-space-2); }
.fullscreen-btn:hover { color: var(--shu-accent); }
.content { overflow: auto; }
:host(.fullscreen) .content { flex: 1; min-height: 0; }
::slotted(img) { display: block; max-width: 100%; cursor: zoom-in; }
:host(.fullscreen) ::slotted(img) { object-fit: contain; height: 100%; cursor: zoom-out; }
/* Thumbnail: keep auxiliary images (e.g. per-step screenshots) small so the step text stays prominent; click or ⤢ to view full. Left edge comes from the container, so the thumbnail aligns under its step. */
:host(.thumb:not(.fullscreen)) { display: inline-block; max-width: 320px; vertical-align: top; margin: var(--shu-space-2) 0; }
:host(.thumb:not(.fullscreen)) ::slotted(img) { max-height: 140px; width: auto; }
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
			<div class="content"><slot></slot></div>`;
		this.shadow.querySelector(".fullscreen-btn")?.addEventListener("click", () => this.setFullscreen(!this.classList.contains("fullscreen")));
		// Clicking the image itself toggles fullscreen (composedPath sees the slotted <img> across the shadow boundary); iframes/pre/links are left to their own behaviour.
		this.shadow.querySelector(".content")?.addEventListener("click", (e) => {
			if (e.composedPath().some((n) => n instanceof HTMLImageElement)) this.setFullscreen(!this.classList.contains("fullscreen"));
		});
		document.addEventListener("keydown", this.onKeydown);
	}

	disconnectedCallback(): void {
		document.removeEventListener("keydown", this.onKeydown);
	}

	private setFullscreen(on: boolean): void {
		this.classList.toggle("fullscreen", on);
		const btn = this.shadow.querySelector(".fullscreen-btn");
		if (btn) {
			btn.textContent = on ? "\u2923" : "\u2922";
			btn.setAttribute("title", on ? "exit fullscreen (Esc)" : "fullscreen");
		}
	}
}

if (!customElements.get("shu-artifact-frame")) customElements.define("shu-artifact-frame", ShuArtifactFrame);
