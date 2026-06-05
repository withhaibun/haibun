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
.fullscreen-btn { background: none; border: none; cursor: pointer; font-size: var(--shu-font-lg); color: var(--shu-fg-faded); padding: 0 var(--shu-space-2); }
.fullscreen-btn:hover { color: var(--shu-accent); }
.content { overflow: auto; }
:host(.fullscreen) .content { flex: 1; min-height: 0; }
::slotted(img) { display: block; max-width: 100%; }
:host(.fullscreen) ::slotted(img) { object-fit: contain; height: 100%; }
::slotted(iframe) { width: 100%; min-height: 200px; border: none; }
::slotted(pre) { margin: 0; padding: var(--shu-space-4) var(--shu-space-5); overflow-x: auto; }
`;

export class ShuArtifactFrame extends HTMLElement {
	private shadow: ShadowRoot;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: "open" });
	}

	connectedCallback(): void {
		const caption = this.getAttribute("caption") ?? "";
		this.shadow.innerHTML = `<style>${STYLES}</style>
			<div class="caption"><span>${caption}</span><button class="fullscreen-btn">\u2922</button></div>
			<div class="content"><slot></slot></div>`;
		this.shadow.querySelector(".fullscreen-btn")?.addEventListener("click", () => {
			this.classList.toggle("fullscreen");
			const btn = this.shadow.querySelector(".fullscreen-btn");
			if (btn) btn.textContent = this.classList.contains("fullscreen") ? "\u2923" : "\u2922";
		});
	}
}

if (!customElements.get("shu-artifact-frame")) customElements.define("shu-artifact-frame", ShuArtifactFrame);
